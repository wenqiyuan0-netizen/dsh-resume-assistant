/**
 * 「经历库」的持久化。
 *
 * 一份纯数据的 JSON 文件（`06-经历库\experiences.json`），结构和简历那边刻意分开：
 * 简历是结构化文档，经历是**用户自己随手记的碎片**（兼职 / 爱好 / 证书 / 小项目），
 * 两者生命周期完全不同 —— 经历库不该被某份简历的模板 / 排版逻辑碰到。
 *
 * 写入规则（都是被"写坏过一次"换来的）：
 *   - **原子**：先写 `experiences.json.tmp-<随机>`，再 `rename` 覆盖。
 *     rename 在同一卷上是原子的，进程中途被杀最多丢这一次改动，不会留下半截 JSON。
 *   - **留一份 .bak**：覆盖前把现有文件复制成 `experiences.json.bak`。
 *     写坏了还能原样捞回来，且不需要用户自己去回收站找。
 *   - **坏文件不拖垮列表**：解析失败时返回空列表 + `error`，UI 能提示，
 *     但用户还能继续新增（下一次成功写入会把备份留下）。
 *
 * 字段演进（向后兼容）：
 *   - 每条 item 除了 `title / period / category / description / tags`，还可以带
 *     一个 `star` 对象（S/T/A/R 四段可选字符串），给面试前背细节用。
 *   - **老条目没有 `star`**：读盘时（`reviveItem` → `normalizeExperience`）补成
 *     四个空串，但**不因为读而回写磁盘** —— 只有真的保存时才落盘。
 *   - 保存时只认 `situation / task / action / result` 四个键，多的丢弃，
 *     每段上限 4000 字符。
 *
 * 零依赖：只用 node:fs / node:crypto / node:path。
 *
 * @module dsh-resume-assistant/lib/experiences
 */
import { randomUUID } from 'node:crypto'
import { copyFile, mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 文件结构版本。以后改结构时靠它做迁移。 */
export const LIBRARY_VERSION = 1

/** 分类建议值（只是下拉建议，自由文本照样能存）。 */
export const CATEGORIES = ['兼职', '项目', '爱好', '证书', '其他']

/**
 * STAR 四段的键名，顺序即口语稿顺序（S → T → A → R）。
 * 导出给路由层 / 测试用；宿主只认这四个键，多传的键在归一化时丢掉。
 */
export const STAR_FIELDS = ['situation', 'task', 'action', 'result']

/** 单个字段的长度上限：防止一个粘贴事故把几十 MB 塞进 JSON。 */
const LIMITS = { title: 200, period: 80, category: 40, description: 20000, tags: 400, star: 4000 }

/**
 * 经历库目录（`<projectRoot>\06-经历库`）。
 * @param config - 已归一化的配置。
 * @returns 绝对路径。
 */
export function experiencesDir(config) {
  return config.experiencesDir ?? join(config.projectRoot, '06-经历库')
}

/**
 * 经历库 JSON 的绝对路径。
 * @param config - 已归一化的配置。
 * @returns 绝对路径。
 */
export function experiencesPath(config) {
  return join(experiencesDir(config), 'experiences.json')
}

/**
 * 收敛成输入框能显示的字符串（null/undefined/对象都不炸）。
 * @param value - 任意值。
 * @returns 字符串。
 */
function asText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/**
 * 按上限裁剪（按码点裁，不切坏 emoji / 中文）。
 * @param value - 原始文本。
 * @param limit - 最大长度。
 * @returns 裁好的字符串。
 */
function clip(value, limit) {
  const chars = [...value]
  return chars.length > limit ? chars.slice(0, limit).join('') : value
}

/**
 * 标签：接受数组或逗号分隔的字符串（中英文逗号都认），去空去重。
 * @param value - 原始值。
 * @returns `string[]`。
 */
export function normalizeTags(value) {
  const raw = Array.isArray(value) ? value.map((item) => asText(item)) : asText(value).split(/[,，、]/)
  const seen = new Set()
  const out = []
  for (const item of raw) {
    const tag = clip(item.trim(), 40)
    if (tag === '' || seen.has(tag)) continue
    seen.add(tag)
    out.push(tag)
    if (out.length >= 20) break
  }
  return out
}

/**
 * 一把空的 STAR 四段。
 *
 * 一律返回**新对象**：调用方拿去 spread 之后可以放心改，不会串到别人身上。
 * 四段都是 `''` 而不是 undefined —— UI 的 `.trim()` / 长度判断不用再兜一层。
 * @returns `{ situation: '', task: '', action: '', result: '' }`。
 */
export function emptyStar() {
  return { situation: '', task: '', action: '', result: '' }
}

/**
 * STAR 里的一段：字符串 trim 后按 4000 裁；数字 / 布尔 `String()` 再 trim；
 * null / undefined / 对象 / 数组一律当空串（粘进来一个 JSON 对象不该变成
 * `[object Object]` 显示在面试稿里）。
 * @param value - 原始值。
 * @returns 规范化后的字符串。
 */
function starText(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return clip(value.trim(), LIMITS.star)
  if (typeof value === 'object') return ''
  return clip(String(value).trim(), LIMITS.star)
}

/**
 * 把任意 `star` 输入归一化成**恰好四个键**的对象。
 *
 * 缺的键补空串、多的键丢弃 —— 这样老条目（没有 `star`）读出来就是四个空串，
 * 新条目带半截 STAR 也不会在 JSON 里留下 undefined（`JSON.stringify` 会把它删掉，
 * 结果下次读回来键就少了，UI 再 `.situation` 就炸）。
 * @param value - 任意输入（对象 / null / 字符串都行）。
 * @returns `{ situation, task, action, result }`，四个值都是字符串。
 */
export function normalizeStar(value) {
  const star = emptyStar()
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return star
  for (const key of STAR_FIELDS) star[key] = starText(value[key])
  return star
}

/**
 * 把一条输入整理成库里的形状（不含 id / 时间戳，那部分由 upsert 决定）。
 *
 * 校验口径：**只有 title 必填**。其余字段空着就空着 —— 用户记经历的第一秒
 * 通常只有一句话，逼他填满五个字段等于不让他记。
 * @param input - 桥上传来的对象。
 * @returns `{ ok: true, value }` 或 `{ ok: false, reason }`。
 */
export function normalizeExperience(input) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: '体验字段必须是一个对象' }
  }
  const title = clip(asText(input.title).trim(), LIMITS.title)
  if (title === '') return { ok: false, reason: 'title 不能为空（一句话标题是必填的）' }
  const category = clip(asText(input.category).trim(), LIMITS.category)
  return {
    ok: true,
    value: {
      title,
      period: clip(asText(input.period).trim(), LIMITS.period),
      category: category === '' ? '其他' : category,
      description: clip(asText(input.description), LIMITS.description),
      tags: normalizeTags(input.tags),
      // 老请求不带 star 也照跑：等价于四个空串
      star: normalizeStar(input.star),
    },
  }
}

/**
 * 规范化一个从磁盘读出来的条目（磁盘可能是旧版本、也可能被手改过）。
 * @param row - 原始对象。
 * @param index - 序号（缺 id 时用来兜底）。
 * @returns 合法条目，或 null（连 title 都没有的垃圾行）。
 */
function reviveItem(row, index) {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return null
  const one = normalizeExperience(row)
  if (one.ok !== true) return null
  const id = typeof row.id === 'string' && row.id.trim() !== '' ? row.id.trim() : `legacy-${index}`
  const now = new Date().toISOString()
  return {
    id,
    ...one.value,
    createdAt: typeof row.createdAt === 'string' && row.createdAt !== '' ? row.createdAt : now,
    updatedAt: typeof row.updatedAt === 'string' && row.updatedAt !== '' ? row.updatedAt : now,
  }
}

/**
 * 读出整份经历库。
 *
 * 文件不存在 = 空库（不是错误）；文件坏了 = 空库 + `error`，UI 会显示这句，
 * 但不会因此禁止新增。
 * @param config - 已归一化的配置。
 * @returns `{ version, items, path, error? }`。
 */
export async function readLibrary(config) {
  const path = experiencesPath(config)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    const code = error?.code
    if (code === 'ENOENT') return { version: LIBRARY_VERSION, items: [], path }
    return { version: LIBRARY_VERSION, items: [], path, error: `读不到 ${path}：${asText(error?.message) || String(error)}` }
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return { version: LIBRARY_VERSION, items: [], path, error: `${path} 不是合法 JSON（保留原文件，未改动）` }
  }
  const rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : []
  const items = []
  for (const [index, row] of rows.entries()) {
    const item = reviveItem(row, index)
    if (item !== null) items.push(item)
  }
  return { version: LIBRARY_VERSION, items, path }
}

/**
 * 原子写入整份经历库。
 *
 * 顺序：建目录 → 备份现有文件到 `.bak` → 写临时文件 → rename 覆盖 → 删残留临时文件。
 * 任何一步失败都抛出来，由路由层翻译成 `{ error }`；**绝不**静默吞掉写失败
 * （那会让 UI 显示"已保存"而磁盘上什么都没有）。
 * @param config - 已归一化的配置。
 * @param items - 完整条目数组。
 * @returns `{ path, backup, bytes }`。
 */
export async function writeLibrary(config, items) {
  const dir = experiencesDir(config)
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'experiences.json')
  const backup = `${path}.bak`

  // 1) 备份现有文件（不存在就跳过）。备份失败不致命：不能因为备份不了就不让用户存。
  try {
    const info = await stat(path)
    if (info.isFile()) await copyFile(path, backup)
  } catch {
    /* 还没有旧文件 */
  }

  // 2) 写临时文件（同目录 → 同一卷，rename 才是原子的）
  const body = JSON.stringify({ version: LIBRARY_VERSION, items }, null, 2)
  const temp = join(dir, `experiences.json.tmp-${process.pid}-${randomUUID().slice(0, 8)}`)
  try {
    await writeFile(temp, body, 'utf8')
    // 3) 原子替换
    await rename(temp, path)
  } catch (error) {
    try {
      await unlink(temp)
    } catch {
      /* 临时文件可能压根没建出来 */
    }
    throw error
  }
  return { path, backup, bytes: Buffer.byteLength(body, 'utf8') }
}

/**
 * upsert 一条经历。
 *
 * 有 `id` 且库里存在 → 更新（保留 createdAt，刷新 updatedAt）；
 * 否则 → 新建（生成 uuid）。
 * @param config - 已归一化的配置。
 * @param input - `{ id?, title, period?, category?, description?, tags? }`。
 * @returns `{ ok, item, action, path }` 或 `{ error }`。
 */
export async function upsertExperience(config, input) {
  const one = normalizeExperience(input)
  if (one.ok !== true) return { error: one.reason }

  const library = await readLibrary(config)
  const items = [...library.items]
  const wanted = typeof input?.id === 'string' ? input.id.trim() : ''
  const index = wanted === '' ? -1 : items.findIndex((item) => item.id === wanted)
  const now = new Date().toISOString()

  let item
  let action
  if (index >= 0) {
    // 更新：createdAt 不动；updatedAt 刷新
    item = { ...items[index], ...one.value, id: items[index].id, createdAt: items[index].createdAt, updatedAt: now }
    items[index] = item
    action = 'updated'
  } else {
    item = { id: randomUUID(), ...one.value, createdAt: now, updatedAt: now }
    // 新的排最前面：用户刚记的东西应该一眼看到
    items.unshift(item)
    action = 'created'
  }

  try {
    const written = await writeLibrary(config, items)
    return { ok: true, item, action, total: items.length, path: written.path, backup: written.backup }
  } catch (error) {
    return { error: `写入失败：${asText(error?.message) || String(error)}` }
  }
}

/**
 * 按 id 删除一条。
 * @param config - 已归一化的配置。
 * @param id - 条目 id。
 * @returns `{ ok, removed, total, path }` 或 `{ error }`。
 */
export async function deleteExperience(config, id) {
  const wanted = asText(id).trim()
  if (wanted === '') return { error: '缺少 id' }
  const library = await readLibrary(config)
  const items = library.items.filter((item) => item.id !== wanted)
  if (items.length === library.items.length) return { error: `没有 id 为 ${wanted} 的经历`, path: library.path }
  try {
    const written = await writeLibrary(config, items)
    return { ok: true, removed: wanted, total: items.length, path: written.path, backup: written.backup }
  } catch (error) {
    return { error: `写入失败：${asText(error?.message) || String(error)}` }
  }
}
