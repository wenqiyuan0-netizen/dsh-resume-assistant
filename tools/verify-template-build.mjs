/**
 * 模板入口自检：上传图 → 面板**直连**派子 agent，不经过 lead、不进对话上下文。
 *
 * 检查：
 *   1. 任务是 spawn（不继承对话）+ label 带模板名；
 *   2. 任务书里带图片绝对路径，并且写死"先 read_image"；
 *   3. 图不存在 / 会话没活着 → 明确 409，不乱派。
 *
 *   node tools/verify-template-build.mjs
 */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerBridge } from '../lib/bridge.js'

const routes = new Map()
const spawns = []
const imagePath = join(tmpdir(), `dsh-rr-ref-${Date.now()}.png`)
writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]))

const parents = new Map([['session-host', { id: 'session-host' }]])

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
      return { get: (id) => parents.get(id), list: () => [...parents.values()] }
    }
    if (name === 'subagents') {
      return {
        startActivation: async (spec) => {
          spawns.push(spec)
          return { childId: 'template-child-1', result: Promise.resolve({ stopReason: 'completed' }) }
        },
      }
    }
    return undefined
  },
}

registerBridge(ctx, {
  config: { appUrl: 'http://127.0.0.1:1', outputDir: '.', scriptDir: '.', projectRoot: '.' },
  service: { status: async () => ({ running: false }), start: async () => ({}), stop: async () => ({}) },
})

const route = routes.get('/api/resume-bridge/template-build')
if (route === undefined) throw new Error('template-build 路由没注册')

const call = async (body) => {
  const response = await route(new Request('http://127.0.0.1/api/resume-bridge/template-build', { method: 'POST', body: JSON.stringify(body) }))
  return { status: response.status, payload: await response.json() }
}

const problems = []
const report = []

// 1) 正常：派一个 spawn 子 agent，任务书写死 read_image
{
  const { status, payload } = await call({ sessionId: 'session-host', imagePath, name: 'orbital' })
  report.push(['正常派发', status, payload.childId ?? ''])
  const spec = spawns.at(-1)
  const prompt = spec?.request?.prompt?.[0]?.text ?? ''
  if (status !== 200 || payload.ok !== true) problems.push('正常派发失败')
  if (spec?.provider !== 'spawn') problems.push('provider 不是 spawn')
  if (spec?.delivery !== 'caller') problems.push('delivery 不是 caller（模板任务不该给 lead 塞通知）')
  // signal 必填：manager 第一件事就是 spec.signal.throwIfAborted()
  if (typeof spec?.signal?.throwIfAborted !== 'function') problems.push('没有传 AbortSignal —— 运行时会报 reading \'throwIfAborted\'')
  if (spec?.signal?.aborted === true) problems.push('signal 一开始就是 aborted')
  if (spec?.request?.parent !== parents.get('session-host')) problems.push('parent 不是宿主会话的 agent')
  if (!prompt.includes(imagePath)) problems.push('任务书里没有图片路径')
  if (!prompt.includes('read_image')) problems.push('任务书没有要求先 read_image 看图')
  if (!String(spec?.label ?? '').includes('orbital')) problems.push('label 里没有模板名')
}

// 2) 图不存在：409，不派
{
  const before = spawns.length
  const { status, payload } = await call({ sessionId: 'session-host', imagePath: join(tmpdir(), 'does-not-exist-xyz.png') })
  report.push(['图不存在', status, payload.code ?? ''])
  if (status !== 409 || payload.code !== 'image-missing') problems.push('图不存在没有返回 image-missing/409')
  if (spawns.length !== before) problems.push('图不存在竟然派了子 agent')
}

// 3) 会话没活着：409
{
  const { status, payload } = await call({ sessionId: 'session-gone', imagePath })
  report.push(['会话没活着', status, payload.code ?? ''])
  if (status !== 409 || payload.code !== 'session-not-live') problems.push('会话没活着没有返回 session-not-live/409')
}

// 4) 没绑定会话：400
{
  const { status, payload } = await call({ imagePath })
  report.push(['未绑定会话', status, payload.code ?? ''])
  if (status !== 400 || payload.code !== 'target-required') problems.push('未绑定会话没有返回 target-required/400')
}

for (const row of report) console.log(row.join('  |  '))
for (const problem of problems) console.log(`✗ ${problem}`)
console.log(problems.length === 0 ? '\n模板直连 ✓' : '\n模板直连 ✗')
process.exitCode = problems.length === 0 ? 0 : 1
