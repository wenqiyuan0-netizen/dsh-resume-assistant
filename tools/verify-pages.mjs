/**
 * 分页/拖拽数据模型自检：给一份两页的文件，检查渲染出两张 sheet。
 *   node tools/verify-pages.mjs
 */
import { renderResumeHtml } from '../lib/render.js'

const doc = {
  basics: { name: 'X' },
  metadata: {
    template: 'gengar',
    layout: {
      pages: [
        { main: ['summary'], sidebar: ['skills'] },
        { main: ['experience'], sidebar: ['languages'] },
      ],
    },
  },
  sections: {
    summary: { items: [] },
    skills: { items: [{ name: 'TypeScript', level: '专家' }] },
    experience: { items: [{ position: '工程师', company: 'ACME', period: { start: '2022-04' } }] },
    languages: { items: [{ language: '中文', fluency: '母语' }] },
  },
}

const html = renderResumeHtml(doc)
const sheets = (html.match(/class="sheet /g) ?? []).length
const hasBreak = html.includes('page-break-after')
const sideOnBoth = (html.match(/class="side[ "]/g) ?? []).length

console.log(`sheet 数量：${sheets}（期望 2）`)
console.log(`打印分页 CSS：${hasBreak ? '有' : '没有'}`)
console.log(`侧栏出现次数：${sideOnBoth}（期望 2 —— 每页各一个侧栏）`)
console.log(`主栏含工作经历：${html.includes('工程师') ? '是' : '否'}（应在第 2 页）`)

const ok = sheets === 2 && hasBreak && sideOnBoth === 2 && html.includes('工程师')
console.log(ok ? '\n分页模型 ✓' : '\n分页模型 ✗')
process.exitCode = ok ? 0 : 1
