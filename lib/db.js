/**
 * 简历数据层：直连本机 PostgreSQL，不经过应用的登录、也不经过它的 MCP。
 *
 * 为什么可以这样：`resume` 表里 `data` 就是整份简历文档（jsonb），应用前端只是它的
 * 一个编辑器。插件自己读写这一列，"登录"就自然与功能无关 —— 不需要改它的 auth 代码，
 * 也不需要一把 API key。
 *
 * 传输细节（这里最容易出事，所以写清楚）：
 * - **SQL 走 stdin**，不走命令行参数：简历 JSON 几 KB～几十 KB，塞进 argv 会被 Windows
 *   命令行长度和引号规则弄坏。
 * - **JSON 走 base64**：拼进 SQL 的字符串字面量只需要 `[A-Za-z0-9+/=]`，
 *   不需要转义、不会被 `$tag$` 撞车、也不受编码影响。
 * - **每次写入前备份**：旧 `data` 存到 `04-输出\_backup\<id>-<时间>.json`，
 *   写坏了还能原样捞回来。
 *
 * @module dsh-resume-assistant/lib/db
 */
import { spawn } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 允许被局部合并的顶层字段（白名单；其余一律不碰）。 */
const MERGEABLE = new Set(['basics', 'summary', 'sections', 'metadata', 'picture', 'customSections'])

/**
 * 跑一段 SQL（stdin 传入），返回 stdout。
 * @param config - 已归一化的配置。
 * @param sql - 完整 SQL 文本。
 * @param signal - 取消信号。
 * @returns `{ ok, stdout, stderr }`。
 */
function runSql(config, sql, signal) {
  return new Promise((resolve) => {
    const psql = join(config.pgBin, 'psql.exe')
    const child = spawn(
      psql,
      ['-h', 'localhost', '-p', '5432', '-U', 'postgres', '-d', 'postgres', '-A', '-t', '-q', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      {
        windowsHide: true,
        env: { ...process.env, PGPASSWORD: 'postgres' },
        signal,
      },
    )
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.on('error', (error) => resolve({ ok: false, stdout, stderr: String(error?.message ?? error) }))
    child.on('close', (code) => resolve({ ok: code === 0, stdout, stderr }))
    child.stdin.end(sql, 'utf8')
  })
}

/**
 * 把一段文本编码成 base64（供 SQL 里 decode 使用）。
 * @param text - 任意 UTF-8 文本。
 * @returns base64。
 */
function toBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64')
}

/**
 * 由一个字符串生成稳定的 UUID v4 形态 id（应用要求 text 主键，但只要形态一致即可）。
 * @returns uuid 字符串。
 */
function newId() {
  const bytes = new Uint8Array(16)
  for (let index = 0; index < 16; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * 深合并：只覆盖 patch 里出现的键，数组整体替换（简历里数组即"整块内容"）。
 * @param base - 原值。
 * @param patch - 局部值。
 * @returns 新值（不改原对象）。
 */
function mergeDeep(base, patch) {
  if (Array.isArray(patch) || patch === null || typeof patch !== 'object') return patch
  const target = base !== null && typeof base === 'object' && !Array.isArray(base) ? { ...base } : {}
  for (const [key, value] of Object.entries(patch)) {
    target[key] = key in target ? mergeDeep(target[key], value) : value
  }
  return target
}

/** 时间戳：文件名安全。 */
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * 创建数据层。
 * @param config - 已归一化的配置。
 * @returns `{ list, get, update, create }`，返回值都是普通 JSON，失败带 `error`。
 */
export function createStore(config) {
  /**
   * 写前备份旧文档。
   * @param id - 简历 id。
   * @param data - 旧文档对象。
   * @returns 备份文件路径，或 undefined。
   */
  async function backup(id, data) {
    try {
      const dir = join(config.outputDir, '_backup')
      await mkdir(dir, { recursive: true })
      const file = join(dir, `${id}-${stamp()}.json`)
      await writeFile(file, JSON.stringify(data, null, 2), 'utf8')
      return file
    } catch {
      return undefined
    }
  }

  /** 列出简历。 */
  async function list(signal) {
    const sql = [
      "select coalesce(json_agg(row_to_json(t)), '[]'::json) from (",
      '  select id, name, slug,',
      "         to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SSZ') as updated_at,",
      "         coalesce(data->'metadata'->>'template', '') as template,",
      "         coalesce(data->'metadata'->'page'->>'locale', '') as locale,",
      '         coalesce(jsonb_array_length(coalesce(data->\'sections\'->\'experience\'->\'items\', \'[]\'::jsonb)), 0) as experience_items',
      '    from resume',
      '   order by updated_at desc',
      ') t;',
      '',
    ].join('\n')
    const result = await runSql(config, sql, signal)
    if (!result.ok) return { error: result.stderr.trim() || 'psql 失败', resumes: [] }
    try {
      const rows = JSON.parse(result.stdout.trim() || '[]')
      return { resumes: rows }
    } catch (error) {
      return { error: `解析列表失败：${error instanceof Error ? error.message : String(error)}`, resumes: [] }
    }
  }

  /**
   * 读一份简历的完整文档。
   * @param id - 简历 id。
   * @param signal - 取消信号。
   * @returns `{ id, name, data }` 或 `{ error }`。
   */
  async function get(id, signal) {
    const safe = String(id).replaceAll("'", "''")
    const sql = [
      'select id, name, slug, encode(convert_to(data::text, \'UTF8\'), \'base64\')',
      '  from resume',
      ` where id = '${safe}';`,
      '',
    ].join('\n')
    const result = await runSql(config, sql, signal)
    if (!result.ok) return { error: result.stderr.trim() || 'psql 失败' }
    const line = result.stdout.trim()
    if (line === '') return { error: `找不到简历 ${id}` }
    const [rowId, name, slug, base64] = line.split('|')
    try {
      const data = JSON.parse(Buffer.from(base64, 'base64').toString('utf8'))
      return { id: rowId, name, slug, data }
    } catch (error) {
      return { error: `解析文档失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  /**
   * 局部更新一份简历（只合并白名单字段）。
   * @param id - 简历 id。
   * @param partial - 要合并的局部文档。
   * @param signal - 取消信号。
   * @returns `{ ok, backup, data }` 或 `{ error }`。
   */
  async function update(id, partial, signal) {
    if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
      return { error: 'partial 必须是对象' }
    }
    const unknown = Object.keys(partial).filter((key) => !MERGEABLE.has(key))
    if (unknown.length > 0) return { error: `不允许改这些字段：${unknown.join(', ')}` }

    const current = await get(id, signal)
    if (current.error !== undefined) return { error: current.error }

    const next = mergeDeep(current.data, partial)
    if (current.data?.id !== undefined) next.id = current.data.id
    else next.id = id

    const backupPath = await backup(id, current.data)
    const base64 = toBase64(JSON.stringify(next))
    const safe = String(id).replaceAll("'", "''")
    const sql = [
      "update resume set",
      "  data = convert_from(decode('" + base64 + "', 'base64'), 'UTF8')::jsonb,",
      '  updated_at = now()',
      ` where id = '${safe}';`,
      "select name from resume where id = '" + safe + "';",
      '',
    ].join('\n')
    const result = await runSql(config, sql, signal)
    if (!result.ok) return { error: result.stderr.trim() || 'psql 失败' }
    return { ok: true, backup: backupPath, name: result.stdout.trim().split('\n').pop(), data: next }
  }

  /**
   * 新建一份简历：复制一份现有文档的结构做骨架（保证与该应用 schema 兼容）。
   * @param name - 简历名字。
   * @param signal - 取消信号。
   * @returns `{ ok, id }` 或 `{ error }`。
   */
  async function create(name, signal) {
    const id = newId()
    const slugBase =
      String(name)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'resume'
    const slug = `${slugBase}-${id.slice(0, 4)}`

    const existing = await runSql(
      config,
      "select id from resume order by updated_at desc limit 1;\n",
      signal,
    )
    let skeleton
    if (existing.ok && existing.stdout.trim() !== '') {
      const template = await get(existing.stdout.trim(), signal)
      skeleton = template.error === undefined ? template.data : undefined
    }
    if (skeleton === undefined) {
      skeleton = {
        basics: { name, headline: '', email: '', phone: '', location: '', website: '', picture: {} },
        summary: { content: '' },
        sections: {},
        customSections: [],
        metadata: {
          template: 'onyx',
          layout: { sidebarWidth: 35, pages: [{ fullWidth: true, main: [], sidebar: [] }] },
          css: { visible: false, value: '' },
          page: { format: 'a4', marginX: 24, marginY: 18, gapX: 12, gapY: 10, locale: 'zh-CN' },
          theme: { background: 'rgba(255,255,255,1)', text: 'rgba(0,0,0,1)', primary: 'rgba(37,99,235,1)' },
          typography: {
            body: { fontFamily: 'IBM Plex Sans', fontSize: 10, lineHeight: 1.4 },
            heading: { fontFamily: 'IBM Plex Sans', fontSize: 14, lineHeight: 1.2 },
          },
          notes: '',
        },
        picture: {
          url: '',
          size: 80,
          aspectRatio: 1,
          borderRadius: 0,
          // 取景位置（百分比，对应 CSS object-position）；50/50 = 居中裁
          position: { x: 50, y: 50 },
          effects: { hidden: false, grayscale: false },
        },
      }
    }
    const users = await runSql(config, 'select id from "user" order by created_at asc limit 1;\n', signal)
    const userId = users.ok ? users.stdout.trim() : ''
    if (userId === '') return { error: '数据库里没有 user 行，无法新建' }

    skeleton.basics = { ...(skeleton.basics ?? {}), name }
    const base64 = toBase64(JSON.stringify(skeleton))
    const sql = [
      'insert into resume (id, name, slug, tags, is_public, is_locked, data, user_id)',
      "values ('" + id + "', '" + String(name).replaceAll("'", "''") + "', '" + slug + "', '{}', false, false,",
      "        convert_from(decode('" + base64 + "', 'base64'), 'UTF8')::jsonb, '" + userId + "');",
      'select id from resume where id = \'' + id + "';\n",
    ].join('\n')
    const result = await runSql(config, sql, signal)
    if (!result.ok) return { error: result.stderr.trim() || 'psql 失败' }
    return { ok: true, id, name }
  }

  return { list, get, update, create }
}
