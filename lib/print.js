/**
 * HTML → PDF，以及逐页位图。
 *
 * 为什么不用 Electron 的 `BrowserWindow`：宿主的插件进程里 `import('electron')`
 * 能解析，但拿到的对象**没有 BrowserWindow**（不是 Electron 主进程）。旧实现只在
 * 那里试一次，于是每次导出都以 `当前进程没有 BrowserWindow` 结束——面板只弹一句
 * "这台机器没有 Electron 打印器"，既没有 PDF 也没有截图。
 *
 * 现在的做法是**先找本机现成的 Chromium**（Chrome / Edge / Chromium / Brave），
 * 用它的无头模式打印 PDF、再按 A4 逐页截图。这条路零依赖、和浏览器预览同一套
 * 排版引擎，而且在纯 Node 进程里可用（已实测：1.8 s 出一份带照片的 A4 PDF）。
 * Electron 只作为第二顺位兜底；两者都没有时才退回 `needsPrint`，把 HTML 交给
 * 客户端让用户自己 Ctrl+P。
 *
 * @module dsh-resume-assistant/lib/print
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** A4 在 96 dpi 下的 CSS 像素：210mm ≈ 793.7px、297mm ≈ 1122.5px。 */
const A4_CSS = { width: 794, height: 1123 }

/** 单次浏览器调用的默认超时。 */
const RUN_TIMEOUT_MS = 90_000

/** 找到的 Chromium 缓存在进程里，避免每次导出都扫一遍磁盘。 */
let cachedChromium

/** 浏览器可执行文件的候选路径（按优先级）。 */
function chromiumCandidates() {
  const env = process.env.RESUME_CHROMIUM ?? process.env.DSH_RESUME_CHROMIUM ?? ''
  const local = process.env.LOCALAPPDATA ?? ''
  const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
  const list = []
  if (env.trim() !== '') list.push(env.trim())
  if (process.platform === 'win32') {
    list.push(
      join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      local === '' ? '' : join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
      join(programFiles, 'Chromium', 'Application', 'chrome.exe'),
      join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'),
    )
  } else if (process.platform === 'darwin') {
    list.push(
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    )
  } else {
    list.push('/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge')
  }
  return list.filter((entry) => entry !== '')
}

/**
 * 找一个可用的 Chromium。
 * @returns `{ path, name }`，找不到返回 null。
 */
export function findChromium() {
  if (cachedChromium !== undefined) return cachedChromium
  for (const candidate of chromiumCandidates()) {
    try {
      if (existsSync(candidate)) {
        cachedChromium = { path: candidate, name: candidate.split(/[\\/]/).pop() ?? 'chromium' }
        return cachedChromium
      }
    } catch {
      /* 没权限就看下一个 */
    }
  }
  cachedChromium = null
  return null
}

/**
 * 跑一个子进程，收齐 stdout/stderr。
 * @param command - 可执行文件。
 * @param args - 参数数组。
 * @param timeoutMs - 超时；超时后 kill。
 * @returns `{ code, stdout, stderr, timedOut }`。
 */
function runProcess(command, args, timeoutMs = RUN_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let child
    try {
      child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, stdout: '', stderr: String(error?.message ?? error), timedOut: false })
      return
    }
    const timer = setTimeout(() => {
      timedOut = true
      try {
        child.kill()
      } catch {
        /* 已经退出 */
      }
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: `${stderr}${String(error?.message ?? error)}`, timedOut })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr, timedOut })
    })
  })
}

/** 数一份 PDF 有几页（数 `/Type /Page` 对象；`/Pages` 是页树，不会被这个正则算进去）。 */
export function countPdfPages(buffer) {
  const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer ?? '')
  const pages = (text.match(/\/Type\s*\/Page[^s]/g) ?? []).length
  if (pages > 0) return pages
  const counted = /\/Count\s+(\d+)/.exec(text)
  return counted === null ? 0 : Number(counted[1])
}

/** 打印/截图共用的浏览器启动参数：别连用户自己的 profile，别弹首启向导。 */
function baseArgs(profileDir) {
  return [
    '--headless=new',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-sync',
    '--user-data-dir=' + profileDir,
  ]
}

/**
 * 把「只看第 index 张纸」的样式与脚本塞进 HTML。
 *
 * 打印时每张 `.sheet` 自己占一页（`page-break-after: always`），截图时没有分页
 * 概念，所以逐页截图靠**隐藏其余纸张**：脚本在解析到 body 末尾时立刻给第 index
 * 张加 `dsh-shot`，其余 `display:none`。这样窗口截图就是一张干净的 A4。
 *
 * @param html - 完整 HTML。
 * @param index - 第几张（0 起）。
 * @returns 新的 HTML。
 */
function isolateSheet(html, index) {
  const style =
    '<style id="dsh-shot">html,body{background:#fff !important;margin:0 !important;padding:0 !important}' +
    '.sheet{display:none !important;margin:0 !important;box-shadow:none !important}' +
    '.sheet.dsh-shot{display:block !important}</style>'
  const script = `<script>(function(){var s=document.querySelectorAll('.sheet');if(s[${index}])s[${index}].classList.add('dsh-shot')})()</script>`
  if (/<\/body>/i.test(html)) return html.replace(/<\/body>/i, `${style}${script}</body>`)
  return html + style + script
}

/** 数 HTML 里有几张纸；一个 `.sheet` 就是打印出来的一页。 */
function countSheets(html) {
  return (String(html ?? '').match(/class="sheet[\s"]/g) ?? []).length
}

/**
 * 量一量这份 HTML 到底有没有"看不见的毛病"。
 *
 * 打印器不会告诉你两件事：内容被 `.sheet` 的固定高度**悄悄裁掉**了（页数看起来
 * 还是 1），以及照片压根没加载出来（`<img>` 在那儿，但 `naturalWidth === 0`）。
 * 两个都是"导出来看着像对、其实缺一块"的经典死法，所以这里用 `--dump-dom` 让页面
 * 自己把测量结果写回 DOM，再从 stdout 里捞回来。
 *
 * @param chromium - `{ path, name }`。
 * @param html - 完整 HTML。
 * @param workDir - 临时目录。
 * @returns `{ sheets: [{height, viewport, clipped}], photo: 'ok'|'missing'|'none'|'unknown', clipped }`
 */
async function measureLayout(chromium, html, workDir) {
  const probe = `<div id="dsh-probe"></div><script>
addEventListener('load', function () {
  var blocks = [].slice.call(document.querySelectorAll('.blk'));
  var clippedBlocks = 0;
  blocks.forEach(function (block) {
    // .blk 是绝对定位 + overflow:hidden 的固定框：内容超了会被**悄悄裁掉**。
    if (block.scrollHeight > block.clientHeight + 2) clippedBlocks += 1;
  });
  var sheets = [].map.call(document.querySelectorAll('.sheet'), function (sheet) {
    return {
      height: sheet.scrollHeight,
      viewport: sheet.clientHeight,
      clipped: sheet.scrollHeight > sheet.clientHeight + 2
    };
  });
  var img = document.querySelector('img.ph');
  var photo = img === null ? 'none' : (img.naturalWidth > 0 ? 'ok' : 'missing');
  var node = document.getElementById('dsh-probe');
  if (node) node.textContent = 'DSH_PROBE:' + JSON.stringify({
    sheets: sheets, blocks: blocks.length, clippedBlocks: clippedBlocks, photo: photo
  });
});
</script>`
  const file = join(workDir, 'measure.html')
  const patched = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${probe}</body>`) : html + probe
  await writeFile(file, patched, 'utf8')
  const profile = join(workDir, 'profile-measure')
  await mkdir(profile, { recursive: true })
  const result = await runProcess(chromium.path, [
    ...baseArgs(profile),
    '--dump-dom',
    '--virtual-time-budget=4000',
    pathToFileURL(file).href,
  ])
  const match = /DSH_PROBE:(\{.*?\})</.exec(result.stdout)
  if (match === null) return { sheets: [], blocks: 0, clippedBlocks: 0, photo: 'unknown', clipped: false }
  try {
    const data = JSON.parse(match[1])
    const sheets = Array.isArray(data.sheets) ? data.sheets : []
    const clippedBlocks = Number(data.clippedBlocks ?? 0)
    return {
      sheets,
      blocks: Number(data.blocks ?? 0),
      clippedBlocks,
      photo: String(data.photo ?? 'unknown'),
      clipped: sheets.some((sheet) => sheet.clipped === true) || clippedBlocks > 0,
    }
  } catch {
    return { sheets: [], blocks: 0, clippedBlocks: 0, photo: 'unknown', clipped: false }
  }
}

/**
 * 用本机 Chromium 打印 PDF。
 * @returns `{ ok, bytes }` 或 `{ ok: false, reason }`。
 */
async function chromiumPrint(chromium, html, targetPath, workDir) {
  const htmlFile = join(workDir, 'print.html')
  await writeFile(htmlFile, html, 'utf8')
  const profile = join(workDir, 'profile-print')
  await mkdir(profile, { recursive: true })
  const result = await runProcess(chromium.path, [
    ...baseArgs(profile),
    '--no-pdf-header-footer',
    '--print-to-pdf-no-header',
    '--print-to-pdf=' + targetPath,
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=6000',
    pathToFileURL(htmlFile).href,
  ])
  try {
    const info = await stat(targetPath)
    if (info.size > 0) return { ok: true, bytes: info.size }
    return { ok: false, reason: `打印器没有写出文件（exit ${result.code}）` }
  } catch {
    const detail = (result.stderr || result.stdout || '').trim().split(/\r?\n/).slice(-3).join(' / ')
    return { ok: false, reason: `打印失败（exit ${result.code}）${detail === '' ? '' : '：' + detail}` }
  }
}

/**
 * 逐页截图。每页一张 `<名字>.png`（第 1 页与 PDF 同名，之后 `-p2`、`-p3`…）。
 * @returns 成功写出的 PNG 绝对路径数组；失败为空数组（不影响 PDF）。
 */
async function chromiumShots(chromium, html, targetPath, pages, workDir) {
  const shots = []
  const stem = targetPath.replace(/\.pdf$/i, '')
  // 截图按**纸**数来（一个 `.sheet` 一张纸），不是按 PDF 页数：
  // 内容溢出时 PDF 页数会多于纸数，那种情况下多出来的页没有对应截图 —— 由
  // `overflow` 标志告诉调用方"这张纸装不下"，别假装拍全了。
  const sheets = countSheets(html)
  const total = Math.max(1, sheets > 0 ? sheets : pages || 1)
  for (let index = 0; index < total; index += 1) {
    const shotPath = index === 0 ? `${stem}.png` : `${stem}-p${index + 1}.png`
    const htmlFile = join(workDir, `shot-${index}.html`)
    await writeFile(htmlFile, isolateSheet(html, index), 'utf8')
    const profile = join(workDir, `profile-shot-${index}`)
    await mkdir(profile, { recursive: true })
    await runProcess(chromium.path, [
      ...baseArgs(profile),
      '--hide-scrollbars',
      '--force-device-scale-factor=2',
      `--window-size=${A4_CSS.width},${A4_CSS.height}`,
      '--screenshot=' + shotPath,
      '--virtual-time-budget=4000',
      pathToFileURL(htmlFile).href,
    ])
    try {
      const info = await stat(shotPath)
      if (info.size > 0) shots.push(shotPath)
    } catch {
      /* 这张没出来就算了，别丢掉 PDF */
    }
  }
  return shots
}

/**
 * Electron 兜底：宿主真的跑在 Electron 主进程里时它更快，值得留一手。
 * @returns `{ ok, bytes, screenshots }` 或 `{ ok: false, reason }`。
 */
async function electronPrint(html, targetPath, pages) {
  let BrowserWindow
  try {
    const electron = await import('electron')
    BrowserWindow = electron?.BrowserWindow ?? electron?.default?.BrowserWindow
  } catch {
    return { ok: false, reason: '没有 Electron' }
  }
  if (typeof BrowserWindow !== 'function') return { ok: false, reason: '当前进程没有 BrowserWindow' }
  let window
  try {
    window = new BrowserWindow({
      show: false,
      width: A4_CSS.width,
      height: A4_CSS.height,
      webPreferences: { offscreen: true, javascript: true, sandbox: true },
    })
    const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`
    await window.loadURL(dataUrl)
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    })
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, pdf)
    const screenshots = []
    // capturePage 只能抓视口，所以逐页：先裁到某一页，再抓。
    for (let index = 0; index < Math.max(1, pages); index += 1) {
      try {
        await window.webContents.executeJavaScript(
          `(()=>{const s=document.querySelectorAll('.sheet');s.forEach((el,i)=>{el.style.display=i===${index}?'block':'none';el.style.margin='0'})})()`,
        )
        const image = await window.webContents.capturePage()
        const shotPath = index === 0 ? targetPath.replace(/\.pdf$/i, '.png') : targetPath.replace(/\.pdf$/i, `-p${index + 1}.png`)
        await writeFile(shotPath, image.toPNG())
        screenshots.push(shotPath)
      } catch {
        break
      }
    }
    return { ok: true, bytes: pdf.length, screenshots }
  } catch (error) {
    return { ok: false, reason: `Electron 打印失败：${error instanceof Error ? error.message : String(error)}` }
  } finally {
    try {
      window?.destroy()
    } catch {
      /* 已经销毁 */
    }
  }
}

/**
 * 打印一份 HTML 成 PDF，并顺手逐页截图。
 *
 * @param html - 完整 HTML 文本。
 * @param targetPath - 目标 `.pdf` 绝对路径。
 * @param options - `{ screenshots?: boolean }`，默认截图。
 * @returns
 * - 成功：`{ ok: true, path, bytes, pages, screenshots, renderer, ms }`
 * - 只能交给人打印：`{ needsPrint: true, html, reason, target }`
 */
export async function htmlToPdf(html, targetPath, options = {}) {
  const started = Date.now()
  const wantsShots = options.screenshots !== false
  const pagesHint = countSheets(html)
  await mkdir(dirname(targetPath), { recursive: true })

  const chromium = findChromium()
  if (chromium !== null) {
    let workDir = ''
    try {
      workDir = await mkdtemp(join(tmpdir(), 'dsh-resume-print-'))
      const printed = await chromiumPrint(chromium, html, targetPath, workDir)
      if (printed.ok === true) {
        const buffer = await readFile(targetPath)
        const pages = countPdfPages(buffer) || pagesHint || 1
        const sheets = pagesHint || 1
        const measured = await measureLayout(chromium, html, workDir).catch(() => ({ sheets: [], photo: 'unknown', clipped: false }))
        const screenshots = wantsShots ? await chromiumShots(chromium, html, targetPath, pages, workDir) : []
        return {
          ok: true,
          path: targetPath,
          bytes: printed.bytes,
          pages,
          sheets,
          overflow: pages > sheets,
          clipped: measured.clipped === true,
          clippedBlocks: measured.clippedBlocks ?? 0,
          photo: measured.photo ?? 'unknown',
          screenshots,
          screenshot: screenshots[0] ?? null,
          renderer: `chromium:${chromium.name}`,
          ms: Date.now() - started,
        }
      }
    } catch (error) {
      // 走到这里说明临时目录/写盘出了问题；继续试 Electron 兜底。
      options.reason = error instanceof Error ? error.message : String(error)
    } finally {
      if (workDir !== '') {
        try {
          await rm(workDir, { recursive: true, force: true })
        } catch {
          /* 临时目录清不掉不影响结果 */
        }
      }
    }
  }

  const electron = await electronPrint(html, targetPath, pagesHint || 1)
  if (electron.ok === true) {
    const buffer = await readFile(targetPath)
    const pages = countPdfPages(buffer) || pagesHint || 1
    const sheets = pagesHint || 1
    return {
      ok: true,
      path: targetPath,
      bytes: electron.bytes ?? buffer.length,
      pages,
      sheets,
      overflow: pages > sheets,
      screenshots: electron.screenshots ?? [],
      screenshot: (electron.screenshots ?? [])[0] ?? null,
      renderer: 'electron',
      ms: Date.now() - started,
    }
  }

  return {
    needsPrint: true,
    html,
    target: targetPath,
    reason:
      chromium === null
        ? `没找到 chromium/chrome/edge，Electron 也不行（${electron.reason}）`
        : `打印失败：${electron.reason}`,
  }
}
