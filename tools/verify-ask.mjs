/**
 * 投递链路自检：`POST /api/resume-bridge/ask` 必须**发到指定的那个会话**。
 *
 * 为什么值得单列一条：
 *   - 宿主不会替你补 `id`；缺 id 的消息写进日志后，整条会话会在下次恢复时判损坏
 *     （`session event at seq N lacks an identified message`）。
 *   - 旧实现把空 `sessionId` 回退成 `agents.list()[0]`，多任务时消息会随机掉进
 *     别的对话。现在空值/未知会话都必须**明确失败**，不许猜。
 *
 *   node tools/verify-ask.mjs
 */
import { registerBridge } from '../lib/bridge.js'

const routes = new Map()
const delivered = []

const liveAgents = new Map([
  ['session-a', { followup: (message) => delivered.push({ session: 'session-a', message }) }],
  ['session-b', { followup: (message) => delivered.push({ session: 'session-b', message }) }],
])

const ctx = {
  logger: { warn() {}, info() {} },
  get: (name) => {
    if (name === 'connection') {
      return {
        fetch: {
          register: ({ path, fetch }) => {
            routes.set(path, fetch)
            return () => routes.delete(path)
          },
        },
      }
    }
    if (name === 'agents') {
      return {
        get: (id) => liveAgents.get(id),
        list: () => [...liveAgents.keys()].map((id) => ({ id, session: { header: { title: id, cwd: '.', parentSession: undefined } }, status: 'idle' })),
      }
    }
    return undefined
  },
}

registerBridge(ctx, {
  config: { appUrl: 'http://127.0.0.1:1', outputDir: '.', scriptDir: '.', projectRoot: '.' },
  service: { status: async () => ({ running: false }), start: async () => ({}), stop: async () => ({}) },
})

const ask = routes.get('/api/resume-bridge/ask')
if (ask === undefined) throw new Error('ask 路由没注册')

const call = async (body) => {
  const response = await ask(
    new Request('http://127.0.0.1/api/resume-bridge/ask', { method: 'POST', body: JSON.stringify(body) }),
  )
  return { status: response.status, payload: await response.json() }
}

const problems = []
const report = []

// 1) 空 sessionId：必须 400 且不投递（绝不回退 [0]）
{
  const { status, payload } = await call({ text: '把简历导出', clientRequestId: 'r1' })
  report.push(['空 sessionId', status, payload.code])
  if (status !== 400 || payload.ok !== false || payload.code !== 'target-required') problems.push('空 sessionId 没有返回 target-required/400')
  if (delivered.length !== 0) problems.push('空 sessionId 竟然投出去了（回退 [0] 的老毛病）')
}

// 2) 未知/已归档会话：必须 409 session-not-live，且不投给第一条
{
  const { status, payload } = await call({ sessionId: 'session-gone', text: '改一下', clientRequestId: 'r2' })
  report.push(['未知会话', status, payload.code])
  if (status !== 409 || payload.code !== 'session-not-live') problems.push('未知会话没有返回 session-not-live/409')
  if (delivered.length !== 0) problems.push('未知会话竟然投给了别的会话')
}

// 3) 指定 session-b：必须只落到 session-b，且消息带 id / user 角色 / 面板标记
{
  const { status, payload } = await call({ sessionId: 'session-b', text: '把这段改短', clientRequestId: 'r3', panel: 'editor' })
  report.push(['指定会话', status, payload.transport])
  const hit = delivered.at(-1)
  if (status !== 200 || payload.ok !== true) problems.push('指定会话投递失败')
  if (hit?.session !== 'session-b') problems.push(`投递落到了 ${String(hit?.session)}，不是 session-b`)
  const message = hit?.message ?? {}
  if (typeof message.id !== 'string' || message.id === '') problems.push('消息没有 id')
  if (message.role !== 'user') problems.push('消息 role 不是 user')
  if (message.source?.kind !== 'user') problems.push('source.kind 不是 user（UI 的排队气泡会看不见）')
  if (message.source?.channel !== 'resume-panel') problems.push('source 没标 resume-panel')
}

// 4) 同一个 clientRequestId 重放：只投一次
{
  const before = delivered.length
  const { payload } = await call({ sessionId: 'session-b', text: '把这段改短', clientRequestId: 'r3', panel: 'editor' })
  report.push(['幂等重放', payload.duplicate === true ? 'duplicate' : 'new'])
  if (payload.duplicate !== true) problems.push('同一个 clientRequestId 没有去重')
  if (delivered.length !== before) problems.push('幂等重放又写了一条消息')
}

for (const row of report) console.log(row.join('  |  '))
for (const problem of problems) console.log(`✗ ${problem}`)
console.log(problems.length === 0 ? '\n投递目标绑定 ✓' : '\n投递目标绑定 ✗')
process.exitCode = problems.length === 0 ? 0 : 1
