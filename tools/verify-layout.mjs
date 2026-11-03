/**
 * 排版自检：**悬空的栏目引用**不许出现在输出里。
 *
 * 真实事故：`metadata.layout.pages` 里留着一条指向"已不存在的栏目"的 UUID
 * （RR 里删掉的自定义栏目，或历史 patch 的残留），面板的「排版与分页」就把它当成
 * 一个栏目块显示成 31 位 id，看起来像"乱码块"。渲染器本来就会过滤，但面板没过滤。
 *
 *   node tools/verify-layout.mjs
 */
import { readFileSync } from 'node:fs'
import { renderResumeHtml } from '../lib/render.js'

const UUID = '019becaf-0b87-769d-98a6-46ccf558c0e8'

const doc = {
  basics: { name: 'Test Person' },
  metadata: {
    template: 'gengar',
    page: { locale: 'zh-CN' },
    layout: {
      pages: [
        { main: ['summary-missing', 'experience'], sidebar: [] },
        { main: [UUID, 'projects'], sidebar: ['skills'] },
      ],
    },
  },
  sections: {
    experience: { title: '工作经历', items: [{ position: '工程师', company: 'ACME' }] },
    projects: { title: '项目', items: [{ name: '迁移' }] },
    skills: { title: '技能', items: [{ name: 'TypeScript' }] },
  },
}

const problems = []
const html = renderResumeHtml(doc, { locale: 'zh-CN' })

// 1) 渲染结果里不许出现悬空引用的 id
if (html.includes(UUID)) problems.push('渲染结果里出现了悬空栏目的 UUID')
if (html.includes('summary-missing')) problems.push('渲染结果里出现了 summary-missing')

// 2) 真实栏目必须还在
for (const needle of ['工程师', '迁移', 'TypeScript']) {
  if (!html.includes(needle)) problems.push(`真实栏目「${needle}」被误删了`)
}

// 3) 面板的排版板必须按真实栏目过滤，并用栏目自己的标题
const client = readFileSync(new URL('../client.js', import.meta.url), 'utf8')
if (!client.includes('sectionKinds.includes(kind)')) problems.push('面板没有按 doc.sections 过滤排版引用')
if (!client.includes('const sectionLabel = (kind)')) problems.push('面板没有 sectionLabel(kind)（会退回硬编码中文名）')
if (!client.includes('?.title || SECTION_LABEL[kind] || kind')) problems.push('sectionLabel 没有优先用 section.title')

// 4) 渲染器同样要有这层过滤（PDF / 预览不能因为脏引用崩掉）
if (!/const known = new Set\(Object\.keys\(sections\)\)/.test(
  readFileSync(new URL('../lib/render/compose.js', import.meta.url), 'utf8'),
)) {
  problems.push('渲染器缺少 known 过滤')
}

console.log(`渲染 ${html.length} 字节；section 数 ${Object.keys(doc.sections).length}；页数 ${doc.metadata.layout.pages.length}`)
for (const problem of problems) console.log(`✗ ${problem}`)
console.log(problems.length === 0 ? '\n排版引用 ✓' : '\n排版引用 ✗')
process.exitCode = problems.length === 0 ? 0 : 1
