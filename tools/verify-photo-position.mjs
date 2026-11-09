/**
 * 照片取景位置自检：`picture.position = {x, y}` 必须变成 `object-position`。
 *
 * 覆盖三件事：
 *  1. 没有 position（老简历）→ 50% 50%，与加字段之前一模一样；
 *  2. 有 position → 原样写进 `<img class="ph">` 的 style；
 *  3. 越界/非数字 → 收敛到 0–100，不会生成 `object-position:150%` 这种坏 CSS。
 */
import { photoPositionOf, renderResumeHtml } from '../lib/render/index.js'

const base = {
  basics: { name: '张三', headline: '工程师' },
  picture: { url: 'data:image/png;base64,AAAA', size: 80, borderRadius: 0, hidden: false },
  sections: { summary: { items: [{ content: '摘要' }] } },
  metadata: { template: 'onyx', layout: { pages: [{ main: ['summary'], sidebar: [] }] } },
}

const positionOf = (html) => {
  const match = /class="ph"[^>]*object-position:([^;"]+)/.exec(html)
  return match === null ? null : match[1].replace(/\s+/g, ' ').trim()
}

const cases = [
  ['缺省（老简历）', {}, '50% 50%'],
  ['自定义', { x: 82, y: 18 }, '82% 18%'],
  ['越界', { x: 150, y: -20 }, '100% 0%'],
  ['非数字', { x: 'abc', y: null }, '50% 50%'],
  ['带小数', { x: 33.6, y: 66.4 }, '34% 66%'],
]

let ok = true
for (const [label, position, expected] of cases) {
  const html = renderResumeHtml({ ...base, picture: { ...base.picture, position } })
  const actual = positionOf(html)
  const pass = actual === expected
  ok = ok && pass
  console.log(`${pass ? '✓' : '✗'} ${label}：${String(actual)}（期望 ${expected}）`)
}

// 侧栏照片（manifest.header.photo === 'side-top'）也只有一条路径要写对。
const sideHtml = renderResumeHtml({
  ...base,
  picture: { ...base.picture, position: { x: 10, y: 90 } },
  metadata: { ...base.metadata, template: 'gengar' },
})
const sideActual = positionOf(sideHtml)
console.log(`${sideActual === '10% 90%' ? '✓' : '✗'} 其它模板（gengar）：${String(sideActual)}（期望 10% 90%）`)
ok = ok && sideActual === '10% 90%'

// 归一化函数本身也得守住边界。
const normalized = [photoPositionOf({}), photoPositionOf({ position: { x: -5, y: 140 } }), photoPositionOf(null)]
const normalizedText = normalized.map((item) => `${item.x}/${item.y}`).join(' · ')
const normalizedOk = normalizedText === '50/50 · 0/100 · 50/50'
ok = ok && normalizedOk
console.log(`${normalizedOk ? '✓' : '✗'} 归一化：${normalizedText}（期望 50/50 · 0/100 · 50/50）`)

console.log(ok ? '\n照片取景位置 ✓' : '\n照片取景位置 ✗')
process.exitCode = ok ? 0 : 1
