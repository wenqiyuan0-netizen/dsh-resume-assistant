/**
 * 自定义模板的持久化。
 *
 * 一个模板 = 一份 manifest JSON（纯数据）。存在简历项目的 `04-输出\_templates\*.json`，
 * 和产物放一起便于备份；渲染器把它和内置 15 份一起解析。
 *
 * @module dsh-resume-assistant/lib/templates-store
 */
import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 允许的取值（保存时校验，挡住"看起来像 manifest 但渲染器不认"的数据）。 */
const ALLOWED = {
  headerPlacement: ['main', 'sidebar'],
  headerPhoto: ['none', 'left', 'right', 'side-top'],
  headerAlign: ['left', 'center'],
  summary: ['main', 'featured'],
  title: ['caps', 'underline', 'bar', 'chip', 'plain'],
  marker: ['none', 'dot', 'timeline'],
  itemLayout: ['stacked', 'inline'],
  skills: ['kv', 'bars', 'chips'],
  sidebarOrder: ['left', 'right'],
}

/**
 * 校验一份 manifest。
 * @param manifest - 待保存对象。
 * @returns `{ ok: true }` 或 `{ ok: false, errors }`。
 */
export function validateManifest(manifest) {
  const errors = []
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) {
    return { ok: false, errors: ['manifest 必须是对象'] }
  }
  const id = manifest.id
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,30}$/.test(id)) {
    errors.push('id 必须是 2–31 位小写字母/数字/连字符，例如 "acme-timeline"')
  }
  const check = (value, list, field) => {
    if (value === undefined) return
    if (!list.includes(value)) errors.push(`${field} 只能是 ${list.join(' / ')}，收到 ${JSON.stringify(value)}`)
  }
  check(manifest.header?.placement, ALLOWED.headerPlacement, 'header.placement')
  check(manifest.header?.photo, ALLOWED.headerPhoto, 'header.photo')
  check(manifest.header?.align, ALLOWED.headerAlign, 'header.align')
  check(manifest.summary, ALLOWED.summary, 'summary')
  check(manifest.title, ALLOWED.title, 'title')
  check(manifest.item?.marker, ALLOWED.marker, 'item.marker')
  check(manifest.item?.layout, ALLOWED.itemLayout, 'item.layout')
  check(manifest.skills?.shape, ALLOWED.skills, 'skills.shape')
  check(manifest.sidebar?.order, ALLOWED.sidebarOrder, 'sidebar.order')

  const width = manifest.sidebar?.width
  if (width !== undefined && (typeof width !== 'number' || width < 18 || width > 48)) {
    errors.push(`sidebar.width 必须是 18–48 的数字，收到 ${JSON.stringify(width)}`)
  }
  const page = manifest.page ?? {}
  for (const [key, range] of Object.entries({ pageY: [8, 30], pageX: [8, 34], section: [1.5, 6], item: [1, 5] })) {
    const value = page[key]
    if (value === undefined) continue
    if (typeof value !== 'number' || value < range[0] || value > range[1]) {
      errors.push(`page.${key} 必须是 ${range[0]}–${range[1]} 的数字，收到 ${JSON.stringify(value)}`)
    }
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/**
 * 模板目录。
 * @param config - 已归一化的配置。
 * @returns 绝对路径。
 */
export function templatesDir(config) {
  return join(config.outputDir, '_templates')
}

/**
 * 列出已保存的自定义模板。
 * @param config - 已归一化的配置。
 * @returns `[{ id, label }]`。
 */
export async function listCustomTemplates(config) {
  const dir = templatesDir(config)
  let names
  try {
    names = await readdir(dir)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const manifest = JSON.parse(await readFile(join(dir, name), 'utf8'))
      if (typeof manifest?.id === 'string') out.push({ id: manifest.id, label: manifest.label ?? manifest.id })
    } catch {
      /* 坏文件跳过，不拖垮列表 */
    }
  }
  return out.sort((left, right) => left.id.localeCompare(right.id))
}

/**
 * 读出全部自定义模板，供渲染器合并。
 * @param config - 已归一化的配置。
 * @returns `{ [id]: manifest }`。
 */
export async function loadCustomTemplates(config) {
  const dir = templatesDir(config)
  const map = {}
  for (const { id } of await listCustomTemplates(config)) {
    try {
      map[id] = JSON.parse(await readFile(join(dir, `${id}.json`), 'utf8'))
    } catch {
      /* 跳过坏文件 */
    }
  }
  return map
}

/**
 * 保存一份模板（覆盖同名）。
 * @param config - 已归一化的配置。
 * @param manifest - 已通过校验的 manifest。
 * @returns `{ ok, path }` 或 `{ error }`。
 */
export async function saveCustomTemplate(config, manifest) {
  const checked = validateManifest(manifest)
  if (checked.ok !== true) return { error: checked.errors.join('；') }
  const dir = templatesDir(config)
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${manifest.id}.json`)
  await writeFile(path, JSON.stringify({ label: manifest.id, ...manifest }, null, 2), 'utf8')
  return { ok: true, path }
}

/**
 * 删除一份自定义模板。
 * @param config - 已归一化的配置。
 * @param id - 模板 id。
 * @returns `{ ok }`。
 */
export async function deleteCustomTemplate(config, id) {
  try {
    await unlink(join(templatesDir(config), `${id}.json`))
    return { ok: true }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}
