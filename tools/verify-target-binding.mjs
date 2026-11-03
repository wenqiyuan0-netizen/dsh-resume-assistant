/**
 * 结构自检：客户端**不许**再出现"随机找一条会话发"的老写法。
 *
 * 为什么用源码断言：client.js 是浏览器侧模块（要 React、要 harness 的客户端运行时），
 * 在 Node 里跑不起来；但这两个 bug 都是"写法"级别的：
 *   - `askAgent('', …)` → 宿主回退 `agents.list()[0]`，消息随机掉进别的对话；
 *   - `sessions[0]` → 面板自己拍的"第一条"，同样随机。
 * 只要源码里不再出现这两种写法，绑定就不可能悄悄退化。
 *
 *   node tools/verify-target-binding.mjs
 */
import { readFileSync } from 'node:fs'

const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
const bridge = readFileSync(new URL('../lib/bridge.js', import.meta.url), 'utf8')
const tools = readFileSync(new URL('../lib/tools.js', import.meta.url), 'utf8')

const problems = []

/** 出现即错：空目标投递。 */
for (const [name, source] of [
  ['client.js', client],
  ['lib/bridge.js', bridge],
]) {
  if (/askAgent\(\s*''/.test(source)) problems.push(`${name} 里还有 askAgent('')（空目标投递）`)
  if (/agents\.list\?\.\(\)\s*\[\s*0\s*\]/.test(source)) problems.push(`${name} 里还有 agents.list()[0] 回退`)
}

/** 出现即错：面板自己拿"第一条"当目标。 */
if (/sessions\s*\[\s*0\s*\]/.test(client)) problems.push('client.js 里还有 sessions[0]')
if (/sessions\[0\]\?\.id/.test(client)) problems.push('client.js 里还有 sessions[0]?.id')

/** 必须存在：绑定链路。 */
for (const [needle, why] of [
  ["inject: ['slots', 'uiSession']", '没注入 uiSession，拿不到"进入时的对话窗口"'],
  ['function useSessionTarget', '没有绑定 hook'],
  ['uiSession', '没有读 uiSession'],
  ['askAgent(target', '发消息时没有用绑定目标'],
  ['withDelegationBlock', '没有委派块（lead 会自己动手排版）'],
  ['resume_dispatch', '没有指向 resume_dispatch 工具'],
  ["postBridge('template-build'", '模板入口没有走直连派发'],
]) {
  const source = needle.includes('resume_dispatch') ? tools : client
  if (!source.includes(needle)) problems.push(`缺少「${needle}」：${why}`)
}

/** 必须消失：旧的"导出到对话"（那条会往上下文里塞"导出成 PDF"）。 */
if (client.includes('exportToChat')) problems.push('client.js 里还有 exportToChat')

/** 画廊：自定义模板必须一起渲小样、必须显示自己的名字。 */
if (!client.includes('galleryIds')) problems.push('画廊没有把自定义模板纳入小样渲染（会一直"加载中…"）')
if (!client.includes('?.label || template')) problems.push('画廊卡片没有用 manifest.label，会显示 31 位 id')

/** 宿主侧必须坚持"精确目标"，不许回退。 */
if (!bridge.includes("code: 'target-required'")) problems.push('bridge.js 没有 target-required 分支')
if (!bridge.includes("code: 'session-not-live'")) problems.push('bridge.js 没有 session-not-live 分支')
if (!bridge.includes("channel: 'resume-panel'")) problems.push('bridge.js 没有给消息打 resume-panel 来源标记')

for (const problem of problems) console.log(`✗ ${problem}`)
console.log(problems.length === 0 ? '绑定写法 ✓（没有随机目标、没有回退）' : '绑定写法 ✗')
process.exitCode = problems.length === 0 ? 0 : 1
