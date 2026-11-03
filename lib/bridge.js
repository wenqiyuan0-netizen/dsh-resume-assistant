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
import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { createStore } from './db.js'
import { htmlToPdf } from './pdf.js'
import { inlinePhoto } from './photo.js'
import { deleteCustomTemplate, listCustomTemplates, loadCustomTemplates, saveCustomTemplate } from './templates-store.js'
import { mkdir as mkdirAsync, writeFile as writeFileAsync } from 'node:fs/promises'
import { templatesDir } from './templates-store.js'
import { renderResumeHtml, safeFileName } from './render.js'
import { buildTemplateTask } from './worker-brief.js'

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
 * @returns `[{ id, title, cwd, status, root }]`，`root` 表示这是工作区里的会话（不是子 agent）。
 */
function listSessions(ctx) {
  let agents
  try {
    agents = ctx.get?.('agents')
  } catch {
    return []
  }
  if (agents === undefined || typeof agents.list !== 'function') return []
  return agents.list().map((agent) => {
    const header = agent?.session?.header ?? {}
    return {
      id: String(agent?.id ?? ''),
      title: String(header.title ?? header.name ?? ''),
      cwd: String(header.cwd ?? ''),
      status: String(agent?.status ?? ''),
      // 根会话 = 没有父会话。子 agent 也在 agents.list() 里，但它不该出现在"投给谁"的候选里。
      root: header.parentSession === undefined,
    }
  })
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
 * 造一条带身份（`id`）的 user 消息。
 *
 * 宿主 **不** 帮你补 id：`agent.followup()` / `inbox.append()` 把传进去的对象
 * 原样记进 `agent/inbox/spliced`，step 开始时又原样写成 `user/message` 事件。
 * 而会话日志的恢复校验（`assertMessageEventShape`）要求每条 message 的 `id`
 * 是非空字符串，否则整条会话判定损坏：
 *
 *   `session event at seq N lacks an identified message`
 *
 * 上游自己发消息走的是 `createUserMessage()`，里面就是 `id: randomUUID()`；
 * 这里等价手搓一份，别再把无 id 的裸对象丢给宿主。
 *
 * `source.kind` 必须是 `user`：对话 UI 的"排队中"气泡只认这个值；插件来源写在
 * 附加字段里（`channel` / `panel`），既不改 UI 行为，又能在日志里认出来。
 *
 * @param text - 消息正文。
 * @param extraSource - 附加的 source 字段（`channel` / `panel`）。
 * @returns 可供 `followup` / `steer` / `inbox.append` 使用的完整消息。
 */
function createIdentifiedUserMessage(text, extraSource = {}) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user', ...extraSource },
  }
}

/**
 * 投递前的最后一道自检：缺 id / role / source / content 的消息一律不交给宿主。
 * @param message - 待投递消息。
 * @returns 缺字段时的原因；完整时返回 `undefined`。
 */
function unidentifiedReason(message) {
  if (typeof message?.id !== 'string' || message.id === '') return '消息缺少 id（写进会话日志会让整条会话判定损坏）'
  if (message.role !== 'user') return `消息 role 必须是 user，当前是 ${String(message.role)}`
  if (!Array.isArray(message.content)) return '消息缺少 content 数组'
  if (typeof message.source?.kind !== 'string' || message.source.kind === '') return '消息缺少 source.kind'
  return undefined
}

/** 幂等键缓存：同一 `clientRequestId` 重复提交只投一次。键是 `会话\0请求 id`。 */
const recentSends = new Map()
const RECENT_SENDS_LIMIT = 256

/**
 * 把一段话投递给**指定的、活着的**会话 agent。
 *
 * 这里有两条硬规则，都是被真实事故换来的：
 *   1. `sessionId` 必填。以前空值会回退到 `agents.list()[0]`，等于把消息随机扔进
 *      这次进程里最早的那个会话——多任务时就是灾难。
 *   2. 目标必须是 `agents.get(id)` 精确拿到的活 agent。会话被归档/关掉就明确失败，
 *      让 UI 提示用户，绝不替用户猜一个。
 *
 * @param ctx - 插件上下文。
 * @param sessionId - 目标会话（必填）。
 * @param text - 消息正文。
 * @param meta - `{ panel, clientRequestId }`。
 * @returns `{ ok, transport?, messageId?, duplicate?, reason?, code? }`。
 */
function deliverToAgent(ctx, sessionId, text, meta = {}) {
  const target = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (target === '') {
    return { ok: false, code: 'target-required', reason: '没有绑定会话：请先在某个对话里打开简历面板（或用面板顶部的会话选择器指定一个）' }
  }

  const requestId = typeof meta.clientRequestId === 'string' ? meta.clientRequestId.trim() : ''
  const dedupeKey = requestId === '' ? '' : `${target}\u0000${requestId}`
  if (dedupeKey !== '' && recentSends.has(dedupeKey)) {
    return { ...recentSends.get(dedupeKey), duplicate: true }
  }

  let agents
  try {
    agents = ctx.get?.('agents')
  } catch {
    agents = undefined
  }
  if (agents === undefined || typeof agents.get !== 'function') return { ok: false, code: 'no-agents', reason: '宿主没有 agents 服务' }

  const agent = agents.get(target)
  if (agent === undefined || agent === null) {
    return {
      ok: false,
      code: 'session-not-live',
      reason: `会话 ${target} 现在没有活着的 agent（被归档、关掉或还没打开）。在对话里打开它，或用面板顶部的会话选择器换一个。`,
    }
  }

  const message = createIdentifiedUserMessage(text, { channel: 'resume-panel', panel: String(meta.panel ?? 'editor') })
  const invalid = unidentifiedReason(message)
  if (invalid !== undefined) return { ok: false, code: 'invalid-message', reason: invalid }

  const remember = (result) => {
    if (dedupeKey === '') return result
    recentSends.set(dedupeKey, result)
    if (recentSends.size > RECENT_SENDS_LIMIT) recentSends.delete(recentSends.keys().next().value)
    return result
  }

  for (const method of ['followup', 'steer']) {
    const call = agent[method]
    if (typeof call !== 'function') continue
    try {
      call.call(agent, message)
      return remember({ ok: true, transport: method, messageId: message.id })
    } catch (error) {
      return { ok: false, code: `${method}-failed`, reason: `${method} 失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  const inbox = agent.inbox
  if (inbox !== undefined && typeof inbox.append === 'function') {
    try {
      // 结构接口是 `append(target, message)`；少传 target 会把消息本身当成队列名。
      inbox.append('next-turn', message)
      return remember({ ok: true, transport: 'inbox.append', messageId: message.id })
    } catch (error) {
      return { ok: false, code: 'inbox-failed', reason: `inbox.append 失败：${error instanceof Error ? error.message : String(error)}` }
    }
  }

  return { ok: false, code: 'no-transport', reason: '该 agent 既没有 followup/steer，也没有 inbox.append' }
}

/**
 * 派一个**不带对话上下文**的简历助手子 agent（模板任务专用）。
 *
 * 与编辑路径的分工：编辑要"改什么"来自对话，所以由 lead 用 `resume_dispatch` 派；
 * 做模板只要图和任务书，面板直接派，不需要 lead 参与（省一次 LLM turn，也不污染上下文）。
 *
 * ⚠️ `startActivation` 会直接 `spec.signal.throwIfAborted()` —— **signal 是必填的**。
 * 少传一个就是 `Cannot read properties of undefined (reading 'throwIfAborted')`，
 * 而且会被包成"派发失败"，看起来像图的问题。所以调用方必须给一个真的 AbortSignal。
 *
 * @param ctx - 插件上下文。
 * @param options - `{ sessionId, imagePath, name, notes, signal }`。
 * @returns `{ ok, childId?, label?, reason?, code? }`。
 */
async function dispatchTemplate(ctx, { sessionId, imagePath, name, notes, signal } = {}) {
  const target = typeof sessionId === 'string' ? sessionId.trim() : ''
  if (target === '') return { ok: false, code: 'target-required', reason: '没有绑定会话：模板任务要挂在某个会话名下' }

  let agents
  let subagents
  try {
    agents = ctx.get?.('agents')
    subagents = ctx.get?.('subagents')
  } catch {
    agents = undefined
    subagents = undefined
  }
  if (agents === undefined || typeof agents.get !== 'function') return { ok: false, code: 'no-agents', reason: '宿主没有 agents 服务' }
  if (subagents === undefined || typeof subagents.startActivation !== 'function') {
    return { ok: false, code: 'no-subagents', reason: '宿主没有 subagents 服务（dsh-subagent 未挂载），无法派子 agent' }
  }

  const parent = agents.get(target)
  if (parent === undefined || parent === null) {
    return { ok: false, code: 'session-not-live', reason: `会话 ${target} 没有活着的 agent，模板任务无法挂载` }
  }

  const path = typeof imagePath === 'string' ? imagePath.trim() : ''
  if (path !== '') {
    try {
      await stat(path)
    } catch {
      return { ok: false, code: 'image-missing', reason: `参考图不存在：${path}` }
    }
  }

  const label = `template-build:${String(name ?? '').trim() || path.split(/[\\/]/).pop() || 'ref'}`
  const prompt = buildTemplateTask({ imagePath: path, name, notes })
  try {
    const activation = await subagents.startActivation({
      provider: 'spawn',
      label,
      request: { parent, prompt: [{ type: 'text', text: prompt }] },
      // 必填：manager 第一件事就是 spec.signal.throwIfAborted()。
      signal: signal ?? new AbortController().signal,
      // caller 交付：不给 lead 塞完成通知（lead 没参与这件事），结果由面板轮询模板库。
      delivery: 'caller',
    })
    Promise.resolve(activation.result).catch((error) => {
      ctx.logger?.warn?.(`resume-assistant: 模板子 agent ${activation.childId} 失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return { ok: true, childId: activation.childId, label }
  } catch (error) {
    return { ok: false, code: 'dispatch-failed', reason: `派发失败：${error instanceof Error ? error.message : String(error)}` }
  }
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

  // 面板直连派发的生命周期信号：插件卸载时把还在跑的模板子 agent 一起取消。
  const dispatchAbort = new AbortController()

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
      return json({ ok: false, code: 'bad-body', reason: '需要 JSON body：{ sessionId, text, clientRequestId? }' }, 400)
    }
    const text = typeof body?.text === 'string' ? body.text.trim() : ''
    if (text === '') return json({ ok: false, code: 'empty-text', reason: 'text 为空' }, 400)
    const result = deliverToAgent(ctx, body?.sessionId, text, {
      panel: body?.panel,
      clientRequestId: body?.clientRequestId,
    })
    // 目标问题用 409：UI 要靠状态码区分"没绑定"和"网络失败"，别一律当成功。
    const status = result.ok === true ? 200 : result.code === 'target-required' ? 400 : 409
    return json(result, status)
  })

  // 模板：面板直接派一个不带对话上下文的子 agent（不经过 lead，也不进上下文）。
  // 返回 childId；面板轮询 `local/templates` 等新模板出现即可。
  route('template-build', ['POST'], async (request) => {
    let body
    try {
      body = await request.json()
    } catch {
      return json({ ok: false, code: 'bad-body', reason: '需要 JSON body：{ sessionId, imagePath, name?, notes? }' }, 400)
    }
    const result = await dispatchTemplate(ctx, {
      sessionId: body?.sessionId,
      imagePath: body?.imagePath,
      name: body?.name,
      notes: body?.notes,
      signal: dispatchAbort.signal,
    })
    const status = result.ok === true ? 200 : result.code === 'target-required' ? 400 : 409
    return json(result, status)
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
            bridgeRoutes: ['state', 'service', 'ask', 'template-build', 'local/list', 'local/get', 'local/update', 'local/create'].map(
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
    // 插件卸载：先把还在跑的模板派发取消掉（它们的 signal 就挂在这个控制器上）。
    try {
      dispatchAbort.abort(new Error('resume-assistant bridge disposed'))
    } catch {
      /* 已经 abort 过 */
    }
    for (const dispose of disposers) {
      Promise.resolve(dispose()).catch(() => undefined)
    }
  }
  if (typeof ctx.effect === 'function') ctx.effect(() => cleanup, { label: 'resume-assistant bridge' })
  return cleanup
}
