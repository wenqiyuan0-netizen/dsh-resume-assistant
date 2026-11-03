/**
 * `resume_dispatch` 自检：lead 只填槽，派活这件事由工具做。
 *
 * 检查三件事：
 *   1. 子 agent 的 parent 就是**调用方 agent**（不是随便挑一个）；
 *   2. 任务书里带着 intent / paths / excerpt（子 agent 不继承对话，全靠这段）；
 *   3. 没有 subagents 服务时明确回一句人话，而不是抛异常。
 *
 *   node tools/verify-dispatch.mjs
 */
import { createToolDefinitions } from '../lib/tools.js'

const spawns = []
const parentAgent = { id: 'session-host', session: { header: { title: 'host' } } }

const config = { appUrl: 'http://127.0.0.1:1', outputDir: '.', scriptDir: '.', projectRoot: '.', nodePath: 'node', scriptDirWin: '.' }
const runner = { run: async () => ({ ok: true, text: '' }) }
const service = { status: async () => ({ running: false }), start: async () => ({}), stop: async () => ({}) }

const withSubagents = {
  logger: { warn() {}, info() {} },
  get: (name) => {
    if (name !== 'subagents') return undefined
    return {
      startActivation: async (spec) => {
        spawns.push(spec)
        return { childId: 'child-1', result: Promise.resolve({ stopReason: 'completed' }) }
      },
    }
  },
}

const definitions = createToolDefinitions({ config, runner, service, ctx: withSubagents })
const dispatch = definitions.find((definition) => definition.name === 'resume_dispatch')
if (dispatch === undefined) throw new Error('resume_dispatch 没注册')

const problems = []
const args = {
  intent: '把第 3 条经历写成两条、每条不超过一行',
  resumeId: 'resume-1',
  paths: ['/sections/experience/items/2'],
  excerpt: '主导 X 平台迁移，把发布耗时从 40 分钟压到 6 分钟。',
}
const answer = await dispatch.execute(args, { agent: parentAgent, signal: undefined })
const spec = spawns.at(-1)
const prompt = spec?.request?.prompt?.[0]?.text ?? ''

if (spawns.length !== 1) problems.push(`startActivation 调了 ${spawns.length} 次，应为 1 次`)
if (spec?.provider !== 'spawn') problems.push(`provider 是 ${String(spec?.provider)}，应为 spawn（spawn 才不继承对话）`)
if (spec?.request?.parent !== parentAgent) problems.push('parent 不是调用方 agent')
if (spec?.delivery !== 'parent') problems.push(`delivery 是 ${String(spec?.delivery)}，应为 parent（完成通知回 lead）`)
if (typeof spec?.signal?.throwIfAborted !== 'function') problems.push("没有传 AbortSignal —— 运行时会报 reading 'throwIfAborted'")
if (!String(spec?.label ?? '').startsWith('resume-edit')) problems.push(`label 是 ${String(spec?.label)}`)
for (const needle of [args.intent, args.paths[0], args.excerpt, 'resume_show', '不许改']) {
  if (!prompt.includes(needle)) problems.push(`任务书里没有「${needle}」`)
}
if (!String(answer?.text ?? '').includes('child-1')) problems.push('返回里没有 childId')

// 没有 subagents 服务时：给一句人话，别抛
const withoutSubagents = createToolDefinitions({ config, runner, service, ctx: { logger: {}, get: () => undefined } })
const fallback = withoutSubagents.find((definition) => definition.name === 'resume_dispatch')
const degraded = await fallback.execute({ intent: '随便改改' }, { agent: parentAgent })
if (!String(degraded?.text ?? '').includes('subagents')) problems.push('没有 subagents 服务时没有给出明确说明')

console.log(`派活次数：${spawns.length}`)
console.log(`provider / delivery / label：${String(spec?.provider)} / ${String(spec?.delivery)} / ${String(spec?.label)}`)
console.log(`任务书长度：${prompt.length} 字`)
for (const problem of problems) console.log(`✗ ${problem}`)
console.log(problems.length === 0 ? '\nresume_dispatch ✓' : '\nresume_dispatch ✗')
process.exitCode = problems.length === 0 ? 0 : 1
