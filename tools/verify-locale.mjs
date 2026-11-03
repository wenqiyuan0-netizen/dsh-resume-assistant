/**
 * 渲染语言自检：栏目名必须跟着**简历自己的 locale** 走。
 *
 * 曾经的 bug：`SECTION_LABEL` 写死中文，一份 de-DE 的简历被盖上「工作经历」，
 * 看起来像"面板语言和正文语言不一致"。
 *
 *   node tools/verify-locale.mjs
 */
import { labelsFor, renderResumeHtml } from '../lib/render.js'

const doc = {
  basics: { name: 'Lena Hoffmann', headline: 'Produktdesignerin', email: 'lena@example.com' },
  metadata: { template: 'gengar', page: { locale: 'de-DE' } },
  sections: {
    summary: { items: [{ content: 'Zehn Jahre Erfahrung.' }] },
    experience: { items: [{ position: 'Designerin', company: 'ACME', period: { start: '2020-04' } }] },
    skills: { items: [{ name: 'Figma', level: '专家' }] },
    languages: { items: [{ language: 'Deutsch', fluency: 'Muttersprache' }] },
  },
}

/** 取出 HTML 里的栏目标题。 */
const headings = (html) => [...html.matchAll(/<h3>([^<]*)<\/h3>/g)].map((match) => match[1])

const problems = []
const cases = [
  ['de-DE', ['Berufserfahrung', 'Kenntnisse', 'Sprachen'], '工作经历'],
  ['en-US', ['Experience', 'Skills', 'Languages'], 'Berufserfahrung'],
  ['zh-CN', ['工作经历', '技能', '语言'], 'Experience'],
]

for (const [locale, expected, forbidden] of cases) {
  const html = renderResumeHtml(doc, { locale })
  const found = headings(html)
  for (const needle of expected) if (!found.includes(needle)) problems.push(`${locale} 缺少「${needle}」：${found.join('/')}`)
  if (found.includes(forbidden)) problems.push(`${locale} 里不该出现「${forbidden}」`)
  console.log(`${locale.padEnd(6)} ${found.join(' · ')}`)
}

// "至今" 也要跟着语言走
const { present } = labelsFor('en-US')
if (present !== 'Present') problems.push(`en 的"至今"是 ${present}`)
const htmlEn = renderResumeHtml(doc, { locale: 'en-US' })
if (!htmlEn.includes('Present')) problems.push('en-US 的时间线没有用 Present')

// 认不出来的 locale 退回中文（和 <html lang> 的默认一致）
if (labelsFor('xx-YY').experience !== '工作经历') problems.push('未知 locale 没有退回中文')

for (const problem of problems) console.log(`✗ ${problem}`)
console.log(problems.length === 0 ? '\n渲染语言 ✓' : '\n渲染语言 ✗')
process.exitCode = problems.length === 0 ? 0 : 1
