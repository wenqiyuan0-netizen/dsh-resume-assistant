/** 自由排版自检：layout.free 存在时应产出画布 + 绝对定位块。 */
import { renderResumeHtml } from '../lib/render/index.js'

const base = {
  basics: { name: 'X' },
  sections: {
    summary: { items: [{ content: '摘要' }] },
    experience: { items: [{ position: '工程师', company: 'ACME' }] },
    skills: { items: [{ name: 'TS' }] },
  },
  metadata: { template: 'onyx', layout: { pages: [{ main: ['summary'], sidebar: [] }] } },
}

const flow = renderResumeHtml(base)
const free = renderResumeHtml({
  ...base,
  metadata: {
    ...base.metadata,
    layout: {
      ...base.metadata.layout,
      free: {
        summary: { x: 0, y: 0, w: 170 },
        experience: { x: 0, y: 40, w: 170 },
        skills: { x: 0, y: 120, w: 80 },
      },
    },
  },
})

const blocks = (free.match(/class="blk"/g) ?? []).length
const abs = free.includes('position: absolute')
const hasHeight = /height:\d+(\.\d+)?mm/.test(free)
const clipped = free.includes('overflow: hidden')
console.log(`流式排版 sheet 数：${(flow.match(/class="sheet /g) ?? []).length}`)
console.log(`自由排版 blk 块数：${blocks}（期望 3）`)
console.log(`绝对定位 CSS：${abs ? '有' : '没有'}`)
console.log(`块高度：${hasHeight ? '写入' : '缺失'}；裁切：${clipped ? '是' : '否'}`)
console.log(`块坐标：${/left:0mm;top:40mm/.test(free) ? '正确写入' : '未写入'}`)
const ok = blocks === 3 && abs && hasHeight && clipped && /left:0mm;top:40mm/.test(free)
console.log(ok ? '\n自由排版 ✓' : '\n自由排版 ✗')
process.exitCode = ok ? 0 : 1
