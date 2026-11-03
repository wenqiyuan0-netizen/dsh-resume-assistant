/**
 * 插件 UI ↔ 宿主 的桥。
 *
 * 走 `ctx.connection.fetch.register()`：这是浏览器端插件**唯一**受支持的
 * 同源、已鉴权 HTTP 入口（上游 `dsh-client-ui-deliverables` 就是这么读宿主数据
 * 的）。客户端用相对路径 `fetch('resume-bridge/state')` 调用，Connection 那层
 * 负责 Host/Origin 校验与浏览器凭证，插件自己不需要令牌。
 *
 * 每个操作都是「宿主方法 + 工具」两个调用方共用同一条实现
 * （启动/停止服务 = service manager；列产出 = 文件系统），不复制逻辑。
 *
 * @module dsh-resume-assistant/lib/bridge
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { createStore } from './db.js'
import { htmlToPdf } from './pdf.js'
import { inlinePhoto } from './photo.js'
import { deleteCustomTemplate, listCustomTemplates, loadCustomTemplates, saveCustomTemplate } from './templates-store.js'
import { mkdir as mkdirAsync, writeFile as writeFileAsync } from 'node:fs/promises'
import { templatesDir } from './templates-store.js'
import { renderResumeHtml, safeFileName } from './render.js'

/**
 * 路由前缀。
 *
 * **必须带 `/api`**：`connection.fetch` 注册的精确路由挂在共享通道 `/api` 下
 * （上游 `dsh-client-ui-deliverables` 就是 `/api/present.host`）。挂到别的前缀上
 * 等于没挂：客户端拿到 404，UI 的「启动服务」就会点了没反应。
 *
 * 同时故意避开 DSH 自己的端点名（`/api/*` 下不会撞车，因为这一段是 `resume-bridge`）。
 */
const BASE = '/api/resume-bridge'

/** 客户端相对形式（`fetch()` 用，不带前导斜杠）。 */
export const BRIDGE_BASE = BASE.slice(1)

/**
 * 构造 JSON 响应。
 * @param data - 任意可序列化数据。
 * @param status - HTTP 状态。
 * @returns Response。
 */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * 读出最近产出（04-输出 下的文件夹与文件）。
 * @param outputDir - 产出根目录。
 * @param limit - 最多几个文件夹。
 * @returns `[{ folder, files: [{ name, path, bytes, mtime }] }]`。
 */
async function readOutputs(outputDir, limit = 4) {
  let entries
  try {
    entries = await readdir(outputDir, { withFileTypes: true })
  } catch {
    return []
  }
  const folders = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const dir = join(outputDir, entry.name)
    let files = []
    try {
      const names = await readdir(dir, { withFileTypes: true })
      for (const file of names) {
        if (!file.isFile()) continue
        const full = join(dir, file.name)
        try {
          const info = await stat(full)
          files.push({ name: file.name, path: full, bytes: info.size, mtime: info.mtimeMs })
        } catch {
          /* 忽略瞬时消失的文件 */
        }
      }
    } catch {
      continue
    }
    files.sort((left, right) => right.mtime - left.mtime)
    folders.push({ folder: entry.name, files: files.slice(0, 8) })
  }
  folders.sort((left, right) => (right.files[0]?.mtime ?? 0) - (left.files[0]?.mtime ?? 0))
  return folders.slice(0, limit)
}

/**
 * 列出可被 UI 选中的会话（"和 agent 讨论"要知道投递到哪个会话）。
 * @param ctx - 插件上下文。
 * @returns `[{ id, title, cwd, status }]`。
 */
function listSessions(ctx) {
  let agents
  try {
    agents = ctx.get?.('agents')
  } catch {
    return []
  }
  if (agents === undefined || typeof agents.list !== 'function') return []
  return agents.list().map((agent) => ({
    id: String(agent?.id ?? ''),
    title: String(agent?.session?.header?.title ?? agent?.session?.header?.name ?? ''),
    cwd: String(agent?.session?.header?.cwd ?? ''),
    status: String(agent?.status ?? ''),
  }))
}

/**
 * 通过应用的 MCP 接口列出简历（服务没跑时返回空）。
 *
 * 这里直接用 fetch 打 `POST /mcp` + `x-api-key`，与 `rr-cv.mjs` 同一条协议：
 * UI 需要一个**结构化**列表（id/名字/更新时间）来填下拉框，而脚本那边输出的是
 * 给人看的文本。密钥只在本机进程内存里读一次，不回给浏览器。
 * @param config - 已归一化的配置。
 * @returns `[{ id, name, slug, updatedAt }]`。
 */
async function listResumes(config) {
  let key
  try {
    key = (await readFile(join(config.scriptDir, 'rr-key.txt'), 'utf8')).trim()
  } catch {
    return []
  }
  if (key === '') return []
  let response
  try {
    response = await fetch(`${config.appUrl}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-api-key': key },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'list_resumes', arguments: {} } }),
      signal: AbortSignal.timeout(15_000),
    })
  } catch {
    return []
  }
  if (!response.ok) return []
  const body = await response.text()
  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    const line = body
      .split(/\r?\n/)
      .filter((entry) => entry.startsWith('data:'))
      .pop()
    if (line === undefined) return []
    try {
      payload = JSON.parse(line.slice(5).trim())
    } catch {
      return []
    }
  }
  const text = (Array.isArray(payload?.result?.content) ? payload.result.content : [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text)
    .join('\n')
  let parsed
  try {
    parsed = JSON.parse(text.trim())
  } catch {
    const start = text.search(/[[{]/)
    if (start < 0) return []
    try {
      parsed = JSON.parse(text.slice(start))
    } catch {
      return []
    }
  }
  const rows = Array.isArray(parsed) ? parsed : (parsed?.resumes ?? parsed?.items ?? [])
  if (!Array.isArray(rows)) return []
  return rows.map((row) => ({
    id: String(row?.id ?? ''),
    name: String(row?.name ?? row?.title ?? '(未命名)'),
    slug: String(row?.slug ?? ''),
    updatedAt: String(row?.updatedAt ?? row?.createdAt ?? ''),
  }))
}

/**
 * 把一段话投递给某个会话的 agent。
 *
 * 依次尝试公开的三种入队能力（README 的 `followup` / `steer` / `inbox.append`），
 * 谁在就用谁；都不在时明确回失败，让 UI 退化成"复制到剪贴板"，而不是假装成功。
 * @param ctx - 插件上下文。
 * @param sessionId - 目标会话。
 * @param text - 消息正文。
 * @returns `{ ok, transport?, reason? }`。
 */
function deliverToAgent(ctx, sessionId, text) {
  let agents
  try {
    agents = ctx.get?.('agents')
  } catch {
    agents = undefined
  }
  if (agents === undefined || typeof agents.get !== 'function') return { ok: false, reason: '宿主没有 agents 服务' }
  const agent = sessionId === '' ? agents.list?.()[0] : agents.get(sessionId)
  if (agent === undefined || agent === null) return { ok: false, reason: `会话 ${sessionId || '(未指定)'} 没有活着的 agent` }

  const message = {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }

  for (const method of ['followup', 'steer']) {
    const call = agent[method]
    if (typeof call !== 'function') continue
    try {
      call.call(agent, message)
      return { ok: true, transport: method }
    } catch (error) {
      return { ok: false, reason: `${method} 失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const inbox = agent.inbox
  if (inbox !== undefined && typeof inbox.append === 'function') {
    try {
      inbox.append(message)
      return { ok: true, transport: 'inbox.append' }
    } catch (error) {
      return { ok: false, reason: `inbox.append 失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  return { ok: false, reason: '该 agent 既没有 followup/steer，也没有 inbox.append' }
}

/**
 * 注册全部桥路由。
 * @param ctx - 插件上下文（需要 connection 服务）。
 * @param options - `{ config, service }`。
 * @returns 一个把全部路由一并注销的清理函数。
 */
export function registerBridge(ctx, { config, service }) {
  const connection = ctx.get?.('connection')
  if (connection === undefined || connection?.fetch?.register === undefined) {
    ctx.logger?.warn?.('resume-assistant: 没有 connection 服务，UI 桥未注册（工具仍可用）')
    return () => {}
  }

  const disposers = []
  const store = createStore(config)

  /**
   * 注册一条精确路由。
   *
   * 重复注册（上一代路由没退干净）**不致命**：记一条警告继续，别让整条插件行
   * 因为一个已经存在的路径而激活失败。
   */
  const route = (path, methods, fetchHandler) => {
    try {
      const dispose = connection.fetch.register({
        path: `${BASE}/${path}`,
        methods,
        requestBody: 'buffered',
        fetch: fetchHandler,
      })
      disposers.push(dispose)
    } catch (error) {
      ctx.logger?.warn?.(
        `resume-assistant: 路由 ${path} 注册失败（可能已存在）：${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  route('state', ['GET'], async () => {
    const status = await service.status()
    const [outputs, resumes] = await Promise.all([
      readOutputs(config.outputDir),
      status.running ? listResumes(config) : Promise.resolve([]),
    ])
    return json({
      status,
      resumes,
      sessions: listSessions(ctx),
      outputs,
      config: {
        appUrl: config.appUrl,
        projectRoot: config.projectRoot,
        outputDir: config.outputDir,
        keyFile: join(config.scriptDir, 'rr-key.txt'),
      },
    })
  })

  route('service', ['POST'], async (request) => {
    let action = 'status'
    try {
      const body = await request.json()
      if (typeof body?.action === 'string') action = body.action
    } catch {
      /* 空 body 视为 status */
    }
    if (action === 'start') return json({ action, ...(await service.start()) })
    if (action === 'stop') return json({ action, ...(await service.stop()) })
    return json({ action: 'status', ok: true, ...(await service.status()) })
  })

  route('ask', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, reason: '需要 JSON body：{ sessionId, text }' }, 400)
    }
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (text === '') return json({ ok: false, reason: 'text 为空' }, 400)
    const sessionId = typeof body?.sessionId === 'string' ? body.sessionId : ''
    return json(deliverToAgent(ctx, sessionId, text))
  })

  // ---------------------------------------------------------------- 本地数据面
  // 直连 Postgres，不经过应用的登录，也不经过它的 MCP：`resume.data` 就是整份文档。
  // 有了这组路由，编辑器在新版 UI 里可以完全脱离那个前端工作。

  route('local/list', ['GET'], async () => json(await store.list()))

  route('local/get', ['GET'], async (request) => {
    const id = new URL(request.url, 'http://localhost').searchParams.get('id') ?? ''
    if (id === '') return json({ error: '缺少 id' }, 400)
    return json(await store.get(id))
  })

  route('local/update', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: '需要 JSON body：{ id, partial }' }, 400)
    }
    const id = typeof body?.id === 'string' ? body.id : ''
    if (id === '') return json({ error: '缺少 id' }, 400)
    return json(await store.update(id, body?.partial ?? {}))
  })

  route('local/create', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const name = typeof body?.name === 'string' && body.name.trim() !== '' ? body.name.trim() : '未命名简历'
    return json(await store.create(name))
  })

  // 渲染：把（可能是未保存的）草稿渲染成独立 HTML。预览与导出共用这一份排版。
  route('local/render', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: '需要 JSON body：{ doc }' }, 400)
    }
    const doc = await inlinePhoto(body?.doc ?? {}, config.appUrl)
    const manifests = await loadCustomTemplates(config)
    const html = renderResumeHtml(doc, { locale: body?.locale, manifests })
    return new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    })
  })

  // 导出：渲染 → 打印成 PDF → 落进 04-输出\<名字>\；没有 Electron 时回 HTML 让客户端打印。
  route('local/export', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: '需要 JSON body：{ id }' }, 400)
    }
    const id = typeof body?.id === 'string' ? body.id : ''
    if (id === '') return json({ error: '缺少 id' }, 400)
    const resume = await store.get(id)
    if (resume.error !== undefined) return json({ error: resume.error }, 400)

    const folder = safeFileName(body?.folder ?? resume.name ?? '未命名', '未命名')
    const file = `${safeFileName(body?.filename ?? `${folder}-CV`, 'resume')}.pdf`
    const target = join(config.outputDir, folder, file)
    const inlined = await inlinePhoto(resume.data, config.appUrl)
    const manifests = await loadCustomTemplates(config)
    const html = renderResumeHtml(inlined, { locale: inlined?.metadata?.page?.locale, manifests })

    const printed = await htmlToPdf(html, target)
    if (printed.ok === true) return json({ ok: true, path: printed.path, bytes: printed.bytes })
    return json({ ok: false, needsPrint: true, html, reason: printed.reason, target })
  })

  // 自定义模板：列表 / 保存 / 删除（保存后渲染器立刻能解析到）
  route('local/templates', ['GET'], async () => json({ templates: await listCustomTemplates(config) }))

  route('local/template-save', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: '需要 JSON body：{ manifest }' }, 400)
    }
    return json(await saveCustomTemplate(config, body?.manifest ?? {}))
  })

  route('local/template-delete', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    const id = typeof body?.id === 'string' ? body.id : ''
    if (id === '') return json({ error: '缺少 id' }, 400)
    return json(await deleteCustomTemplate(config, id))
  })

  // 参考图上传：把截图存到 04-输出\_templates\refs\，交给子 agent 当"案例"
  route('local/template-upload', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ error: '需要 JSON body：{ name, dataUrl }' }, 400)
    }
    const dataUrl = typeof body?.dataUrl === 'string' ? body.dataUrl : ''
    const match = /^data:(image\/(png|jpeg|webp));base64,(.+)$/.exec(dataUrl)
    if (match === null) return json({ error: '只接受 png/jpeg/webp 的 data URL' }, 400)
    const ext = match[2] === 'jpeg' ? 'jpg' : match[2]
    const safe = String(body?.name ?? 'ref').replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 40) || 'ref'
    const dir = join(templatesDir(config), 'refs')
    await mkdirAsync(dir, { recursive: true })
    const target = join(dir, `${safe}-${Date.now()}.${ext}`)
    await writeFileAsync(target, Buffer.from(match[3], 'base64'))
    return json({ ok: true, path: target })
  })

  // 自检路由：**故意不放在 `/api` 下**，这样不依赖浏览器凭证就能用 curl 打到。
  // 它只读状态、不复述密钥，用来回答"插件这一代到底加载了没有、桥挂在哪、服务在不在"。
  const webServer = ctx.get?.('webServer')
  if (webServer !== undefined && typeof webServer.register === 'function') {
    try {
      const dispose = webServer.register({
        kind: 'exact',
        path: '/resume-diag2',
        handler: async (_request, response) => {
          const status = await service.status()
          const local = await store.list()
          const payload = {
            plugin: 'dsh-resume-assistant',
            bridgeBase: BASE,
            bridgeRoutes: ['state', 'service', 'ask', 'local/list', 'local/get', 'local/update', 'local/create'].map(
              (name) => `${BASE}/${name}`,
            ),
            connectionService: ctx.get?.('connection') !== undefined,
            webServerRoute: '/resume-diag2',
            status,
            sessions: listSessions(ctx).length,
            localResumes: (local.resumes ?? []).length,
            localError: local.error ?? null,
            localNames: (local.resumes ?? []).map((row) => row.name),
          }
          response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
          response.end(JSON.stringify(payload))
        },
      })
      disposers.push(dispose)
    } catch (error) {
      ctx.logger?.warn?.(`resume-assistant: /resume-diag2 注册失败（可能已存在）：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * 清理：路由必须随插件 fiber 卸载，否则禁用→再启用会撞 "duplicate exact route"。
   * `ctx.effect` 只接收工厂，工厂返回的就是 disposer（这里不立即执行清理）。
   */
  const cleanup = () => {
    for (const dispose of disposers) {
      Promise.resolve(dispose()).catch(() => undefined)
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => cleanup, { label: 'resume-assistant bridge' })
  return cleanup
}
