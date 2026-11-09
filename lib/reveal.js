/**
 * 在资源管理器里选中一个文件 / 用默认程序打开它。
 *
 * 「导出完了，文件在哪？」——这一步以前得让人自己去 `04-输出` 里翻。导出作业
 * 结束时会顺手把文件选中，客户端也留一个按钮随时再叫一次。
 *
 * 三条教训写在这里，别再踩：
 *
 * 1. **不要用"进程起来了"当成功**。`spawn()` 只要没抛异常就算成功，可
 *    `explorer.exe` 完全可以立刻退出、什么也不开。旧实现就是这样：返回 `true`，
 *    用户屏幕上什么都没有 —— 面板上的按钮就成了"点了没反应"。
 * 2. **不要假设 `import('electron')` 能拿到 shell**。插件进程里那个模块可能只是
 *    npm 包的路径字符串（`shell` 是 `undefined`），也可能它真在 Electron 里。
 *    先看 `process.versions.electron`，再看 `shell` 是不是真有方法。
 * 3. **`.pdf` 的关联可能是坏的**。这台机器上 `.pdf` 指向 `MSEdgePDF`，可
 *    `Start-Process` 与 `explorer <pdf>` 都**不启动任何东西**（而 `.txt` 能正常打开
 *    Notepad），所以"用默认程序打开"必须**去看窗口有没有真的出现**，没出现就退到
 *    本机的浏览器，而不是回一句 success 收工。
 *
 * @module dsh-resume-assistant/lib/reveal
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

/**
 * 起一个子进程，收 stdout/stderr，最多等 timeoutMs。
 *
 * 超时也算"没失败"：GUI 程序（explorer、浏览器）常常不退出，等不到 close。
 *
 * @param command - 可执行文件。
 * @param args - 参数数组。
 * @param timeoutMs - 等多久。
 * @returns `{ ok, code, stdout, stderr, timedOut }`。
 */
function launch(command, args, timeoutMs = 4000) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (error) {
      resolve({ ok: false, code: -1, stdout: '', stderr: String(error?.message ?? error), timedOut: false })
      return
    }
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      resolve(payload)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* 已经退出 */
      }
      finish({ ok: true, code: null, stdout, stderr, timedOut: true })
    }, timeoutMs)
    child.stdout?.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      finish({ ok: false, code: -1, stdout, stderr: `${stderr}${String(error?.message ?? error)}`, timedOut: false })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      finish({ ok: (code ?? -1) === 0, code: code ?? -1, stdout, stderr, timedOut: false })
    })
  })
}

/** 真在 Electron 里吗？只有那时 `shell` 才值得相信。 */
async function electronShell(method, path) {
  if (typeof process.versions?.electron !== 'string') return { ok: false, detail: '不是 Electron 进程' }
  try {
    const electron = await import('electron')
    const shell = electron?.shell ?? electron?.default?.shell
    if (shell === undefined || typeof shell[method] !== 'function') {
      return { ok: false, detail: 'Electron 里没有 shell' }
    }
    if (method === 'showItemInFolder') {
      shell.showItemInFolder(path)
      return { ok: true, detail: 'electron:showItemInFolder' }
    }
    const error = await shell.openPath(path)
    return typeof error === 'string' && error !== ''
      ? { ok: false, detail: `electron:openPath → ${error}` }
      : { ok: true, detail: 'electron:openPath' }
  } catch (error) {
    return { ok: false, detail: `electron 调用失败：${error instanceof Error ? error.message : String(error)}` }
  }
}

/** 把路径写成 PowerShell 单引号字面量。 */
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/**
 * 在 Windows 上用 ShellExecute 选中文件，并**确认窗口真的出现了**。
 *
 * 为什么不能只看退出码：`Start-Process explorer.exe` 秒退且永远 code 0，
 * 开没开窗口只有"有没有新窗口"能回答。这里让 PowerShell 自己去点名。
 *
 * @param path - 绝对路径。
 * @returns `{ ok, detail }`。
 */
async function windowsSelect(path) {
  const script = [
    `$target = ${psQuote(path)}`,
    `$name = [IO.Path]::GetFileName($target)`,
    `Start-Process -FilePath explorer.exe -ArgumentList ('/select,"' + $target + '"') -ErrorAction SilentlyContinue`,
    `Start-Sleep -Milliseconds 1200`,
    `$hit = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' -and $_.MainWindowTitle -like ('*' + [IO.Path]::GetFileName([IO.Path]::GetDirectoryName($target)) + '*') })`,
    `if ($hit.Count -gt 0) { 'OPENED' } else { 'NOTHING' }`,
  ].join('; ')
  const ran = await launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], 12_000)
  const out = ran.stdout.trim()
  if (out.includes('OPENED')) return { ok: true, detail: 'shell:explorer /select（窗口已出现）' }

  // 退路：直接叫 explorer（最原始的那种）。
  const direct = await launch('explorer.exe', [`/select,${path}`])
  await new Promise((resolve) => setTimeout(resolve, 900))
  const verify = await launch('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-WindowStyle',
    'Hidden',
    '-Command',
    `$n = [IO.Path]::GetFileName([IO.Path]::GetDirectoryName(${psQuote(path)})); if (@(Get-Process explorer -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -like ('*' + $n + '*') }).Count -gt 0) { 'OPENED' } else { 'NOTHING' }`,
  ])
  const second = verify.stdout.trim()
  if (second.includes('OPENED')) return { ok: true, detail: 'explorer.exe /select（窗口已出现）' }
  return {
    ok: false,
    detail: `没能打开资源管理器：${
      (direct.stderr || ran.stderr || '').trim().slice(0, 160) || '两次启动都没有出现窗口'
    }`,
  }
}

/** 本机可用的浏览器（PDF 都能看）：Edge → Chrome。 */
function viewers() {
  const programFiles = process.env.PROGRAMFILES ?? 'C:\\Program Files'
  const programFilesX86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'
  const local = process.env.LOCALAPPDATA ?? ''
  return [
    join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
    join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    local === '' ? '' : join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
  ].filter((entry) => entry !== '' && existsSync(entry))
}

/**
 * 在 Windows 上"用默认程序打开一个文件"，并确认真的打开了。
 *
 * 先交给系统（ShellExecute），等 1.6 s 看有没有哪个窗口的标题带这个文件名；
 * 没有就说明关联是坏的（这台机器正是如此），退到本机浏览器的 `文件路径` 参数。
 *
 * @param path - 绝对路径。
 * @returns `{ ok, detail }`。
 */
async function windowsOpen(path) {
  const fileName = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  // 必须比较"打开前后"：只问"有没有这个标题的窗口"会被**已经开着的那份**骗过去，
  // 于是什么都没发生也报成功 —— 这正是上一个版本的毛病。
  const script = [
    `$target = ${psQuote(path)}`,
    `$name = ${psQuote(fileName)}`,
    `$before = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { $_.Id.ToString() + '|' + $_.MainWindowTitle })`,
    `Start-Process -FilePath $target -ErrorAction SilentlyContinue`,
    `Start-Sleep -Milliseconds 1800`,
    `$after = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -ne '' } | ForEach-Object { $_.Id.ToString() + '|' + $_.MainWindowTitle })`,
    `$fresh = @($after | Where-Object { $before -notcontains $_ })`,
    `$hit = @($fresh | Where-Object { $_ -like ('*' + $name + '*') })`,
    `if ($hit.Count -gt 0) { 'OPENED:' + $hit[0] } elseif ($fresh.Count -gt 0) { 'OTHER:' + $fresh[0] } else { 'NOTHING' }`,
  ].join('; ')
  const ran = await launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], 14_000)
  const out = ran.stdout.trim()
  if (out.includes('OPENED:')) {
    return { ok: true, detail: '系统默认程序（窗口已出现）' }
  }

  // 关联坏了：本机浏览器都能直接看 PDF。这是"能打开"和"点了没反应"之间的差别。
  for (const exe of viewers()) {
    const opened = await launch(exe, [path], 6_000)
    if (opened.ok === true || opened.timedOut === true) {
      return { ok: true, detail: `系统没打开，改用 ${exe.split(/[\\/]/).pop()}（.pdf 关联是坏的，退到浏览器）` }
    }
  }
  return { ok: false, detail: '系统默认程序与备用浏览器都没能打开它（先「打开文件夹」，再双击试试）' }
}

/**
 * 在文件管理器里选中该文件（不是打开它）。
 * @param path - 目标文件的绝对路径。
 * @returns `{ ok, method, detail }`：真的成功了吗、走的哪条路、失败了为什么。
 */
export async function revealPath(path) {
  const target = String(path ?? '').trim()
  if (target === '') return { ok: false, method: 'none', detail: '没有路径' }

  const viaElectron = await electronShell('showItemInFolder', target)
  if (viaElectron.ok === true) return { ok: true, method: 'electron', detail: viaElectron.detail }

  if (process.platform === 'win32') {
    const result = await windowsSelect(target)
    return { ok: result.ok, method: result.detail.startsWith('shell') ? 'powershell' : 'explorer.exe', detail: result.detail }
  }
  if (process.platform === 'darwin') {
    const ran = await launch('open', ['-R', target])
    return { ok: ran.ok, method: 'open', detail: ran.ok ? 'open -R' : `open 失败：${ran.stderr.trim().slice(0, 200)}` }
  }
  const ran = await launch('xdg-open', [dirname(target)])
  return { ok: ran.ok, method: 'xdg-open', detail: ran.ok ? 'xdg-open' : `xdg-open 失败：${ran.stderr.trim().slice(0, 200)}` }
}

/**
 * 用默认程序打开这个文件。
 * @param path - 绝对路径。
 * @returns `{ ok, method, detail }`。
 */
export async function openPath(path) {
  const target = String(path ?? '').trim()
  if (target === '') return { ok: false, method: 'none', detail: '没有路径' }

  const viaElectron = await electronShell('openPath', target)
  if (viaElectron.ok === true) return { ok: true, method: 'electron', detail: viaElectron.detail }

  if (process.platform === 'win32') {
    const result = await windowsOpen(target)
    return { ok: result.ok, method: result.detail.includes('改用') ? 'viewer' : 'shell', detail: result.detail }
  }
  if (process.platform === 'darwin') {
    const ran = await launch('open', [target])
    return { ok: ran.ok, method: 'open', detail: ran.ok ? 'open' : `open 失败：${ran.stderr.trim().slice(0, 200)}` }
  }
  const ran = await launch('xdg-open', [target])
  return { ok: ran.ok, method: 'xdg-open', detail: ran.ok ? 'xdg-open' : `xdg-open 失败：${ran.stderr.trim().slice(0, 200)}` }
}
