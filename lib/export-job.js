/**
 * 导出作业：一条实现，桥（面板）和工具（`resume_export`）都调它。
 *
 * 以前导出的每一步散在三处（`bridge.js` 的 `local/export`、`tools.js` 的
 * `resume_export`、客户端的打印兜底），于是三处各错一半：桥不写索引、工具不返回
 * 页数、客户端以为截图会自己出现。现在收敛到这里：
 *
 *   取文档 → 内联照片 → 渲染同一份 HTML → 解析目标路径与覆盖策略 →
 *   打印 PDF + 逐页 PNG → 写 `_索引.md` → （可选）在资源管理器里选中它
 *
 * 「新内容覆盖」是这里的第二条硬规矩：**能传进实时草稿就绝不用库里的旧副本**。
 * 面板里改了还没点保存的内容，导出时也必须在纸面上。
 *
 * @module dsh-resume-assistant/lib/export-job
 */
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { mkdir, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { htmlToPdf } from './print.js'
import { inlinePhoto } from './photo.js'
import { loadCustomTemplates } from './templates-store.js'
import { renderResumeHtml, safeFileName } from './render.js'
import { openPath, revealPath } from './reveal.js'

/** 默认文件名后缀。 */
const DEFAULT_SUFFIX = '-CV'

/**
 * 把一个已存在的路径变成 `名字 (2).pdf`、`名字 (3).pdf`…
 * @param target - 想要的绝对路径。
 * @returns 第一个不存在的路径。
 */
function uniquePath(target) {
  if (!existsSync(target)) return target
  const stem = target.replace(/\.pdf$/i, '')
  for (let index = 2; index < 1000; index += 1) {
    const candidate = `${stem} (${index}).pdf`
    if (!existsSync(candidate)) return candidate
  }
  return `${stem} (${Date.now()}).pdf`
}

/**
 * 目标路径与"会不会覆盖谁"。
 *
 * @param config - 运行期配置。
 * @param options - `{ name, folder, filename }`。
 * @returns
 * ```
 * { folder, file, path, exists, bytes, mtime }
 * ```
 */
export function planExport(config, options = {}) {
  const name = String(options.name ?? '').trim()
  const folder = safeFileName(options.folder ?? name ?? '未命名', '未命名')
  // 人可能在输入框里打了 .pdf，扩展名只能有一个。
  const named = safeFileName(String(options.filename ?? '').trim() || `${folder || 'resume'}${DEFAULT_SUFFIX}`, 'resume').replace(
    /\.pdf$/i,
    '',
  )
  const file = `${named}.pdf`
  const path = join(config.outputDir, folder, file)
  let info = null
  try {
    const stats = statSync(path)
    info = { exists: true, bytes: stats.size, mtime: stats.mtime.toISOString() }
  } catch {
    info = { exists: false, bytes: 0, mtime: null }
  }
  return { folder, file, path, ...info }
}

/**
 * 把一条链接插进 `_索引.md` 对应的小节（没有就新建），并去重。
 * @param outputDir - 产出根目录。
 * @param folder - 子目录名。
 * @param filename - PDF 文件名。
 * @returns 一句话说明发生了什么。
 */
export function updateIndex(outputDir, folder, filename) {
  const indexFile = join(outputDir, '_索引.md')
  const rel = `${folder}\\${filename}`
  const line = `- [${filename}](${rel})`
  let md = existsSync(indexFile)
    ? readFileSync(indexFile, 'utf8')
    : '# 📄 产出索引\n\n> 所有简历 PDF 和预览图集中管理，点击文件名即可打开。\n'
  if (md.includes(line)) return '（索引里已存在，未重复添加）'

  const lines = md.split(/\r?\n/)
  const head = `## ${folder}`
  const at = lines.findIndex((entry) => entry.trim() === head)
  if (at === -1) {
    if (lines.at(-1)?.trim() !== '') lines.push('')
    lines.push(head, '', line, '')
  } else {
    let end = lines.length
    for (let index = at + 1; index < lines.length; index += 1) {
      if (/^##\s/.test(lines[index])) {
        end = index
        break
      }
    }
    let insert = end
    while (insert > at + 1 && lines[insert - 1].trim() === '') insert -= 1
    lines.splice(insert, 0, line)
  }
  writeFileSync(indexFile, lines.join('\n'), 'utf8')
  return '已加入索引'
}

/**
 * 从一条简历引用解析出 id。
 * @param store - `createStore(config)`。
 * @param ref - id / id 前缀 / slug / 名字。
 * @returns id 或 null。
 */
export async function resolveResumeId(store, ref) {
  const wanted = String(ref ?? '').trim().toLowerCase()
  if (wanted === '') return null
  const list = await store.list()
  const resumes = Array.isArray(list?.resumes) ? list.resumes : []
  const norm = (value) => String(value ?? '').trim().toLowerCase()
  const hit =
    resumes.find((row) => norm(row.id) === wanted) ||
    resumes.find((row) => norm(row.slug) === wanted) ||
    resumes.find((row) => norm(row.name) === wanted) ||
    resumes.find((row) => norm(row.id).startsWith(wanted))
  return hit ? hit.id : null
}

/**
 * 导出作业。
 *
 * @param options - 见下；`store` 与 `config` 必填。
 * @returns
 * ```
 * { ok: true, path, folder, file, dir, bytes, pages, screenshots, screenshot,
 *   renderer, ms, overwrote, previous, index, revealed }
 * 或 { ok: false, reason, needsPrint? }
 * ```
 */
export async function runExport(options) {
  const config = options.config
  const store = options.store
  const started = Date.now()

  // 1. 文档：实时草稿优先，其次库里那份。
  let doc = options.doc !== undefined && options.doc !== null && typeof options.doc === 'object' ? options.doc : null
  let name = String(options.name ?? '').trim()
  let id = typeof options.id === 'string' ? options.id : ''
  if (doc === null) {
    const ref = id !== '' ? id : String(options.ref ?? '').trim()
    if (ref === '') return { ok: false, reason: '缺少 id（或传一份 doc 草稿）' }
    if (id === '') id = (await resolveResumeId(store, ref)) ?? ''
    if (id === '') return { ok: false, reason: `找不到简历 ${ref}` }
    const record = await store.get(id)
    if (record.error !== undefined) return { ok: false, reason: record.error }
    doc = record.data
    if (name === '') name = String(record.name ?? '')
  }
  if (doc === null) return { ok: false, reason: '没有可导出的简历内容' }
  if (name === '') name = String(doc?.basics?.name ?? '').trim()

  // 2. 路径与覆盖策略。
  const plan = planExport(config, { name, folder: options.folder, filename: options.filename })
  const overwrite = options.overwrite === 'version' ? 'version' : 'overwrite'
  const target = overwrite === 'version' ? uniquePath(plan.path) : plan.path
  const previous = existsSync(target) ? planExport(config, { name, folder: options.folder, filename: options.filename }) : null

  // 3. 渲染（照片内联：预览与 PDF 都自包含）。
  let inlined
  try {
    inlined = await inlinePhoto(doc, config.appUrl, { appDir: config.appDir })
  } catch {
    inlined = doc
  }
  const manifests = await loadCustomTemplates(config)
  const html = renderResumeHtml(inlined, { locale: inlined?.metadata?.page?.locale, manifests })

  // 4. 打印 + 逐页截图。
  await mkdir(dirname(target), { recursive: true })
  const printed = await htmlToPdf(html, target, { screenshots: options.screenshots !== false })
  if (printed.ok !== true) {
    return {
      ok: false,
      reason: printed.reason ?? '打印失败',
      needsPrint: printed.needsPrint === true,
      html: printed.html,
      target,
    }
  }

  // 5. 索引（人和 agent 都靠它找文件）。
  let indexNote = ''
  try {
    indexNote = updateIndex(config.outputDir, dirname(target).split(/[\\/]/).pop() ?? plan.folder, target.split(/[\\/]/).pop() ?? plan.file)
  } catch (error) {
    indexNote = `索引没写进去：${error instanceof Error ? error.message : String(error)}`
  }

  // 6. 自动进文件夹（"导出了，文件在哪"这一步不该让人自己找）。
  // 结果带上"走了哪条路"，失败时客户端能把原因说出来，而不是装作点了没反应。
  let reveal = null
  if (options.reveal === true) reveal = await revealPath(target)

  const info = await stat(target)
  return {
    ok: true,
    id,
    name,
    path: target,
    dir: dirname(target),
    folder: plan.folder,
    file: target.split(/[\\/]/).pop() ?? plan.file,
    bytes: info.size,
    pages: printed.pages ?? 0,
    sheets: printed.sheets ?? printed.pages ?? 0,
    overflow: printed.overflow === true,
    clipped: printed.clipped === true,
    clippedBlocks: printed.clippedBlocks ?? 0,
    photo: printed.photo ?? 'unknown',
    screenshots: printed.screenshots ?? [],
    screenshot: printed.screenshot ?? null,
    renderer: printed.renderer ?? 'unknown',
    ms: Date.now() - started,
    overwrote: previous !== null,
    previous: previous === null ? null : { bytes: previous.bytes, mtime: previous.mtime },
    index: indexNote,
    revealed: reveal?.ok === true,
    reveal: reveal ?? null,
  }
}

/** 打开一份产出的 PDF（默认程序）。 */
export async function openExported(path) {
  return openPath(path)
}
