/** 模板流水线自检：brief → save → list → 用新模板渲染。 */
import { normalizeConfig } from '../lib/config.js'
import { createStore } from '../lib/db.js'
import { renderResumeHtml } from '../lib/render/index.js'
import { buildTemplateBrief } from '../lib/template-brief.js'
import { deleteCustomTemplate, listCustomTemplates, loadCustomTemplates, saveCustomTemplate } from '../lib/templates-store.js'

const config = normalizeConfig({})
const id = 'dsh-test-timeline'

const brief = buildTemplateBrief({ reference: '04-输出/refs/acme.pdf', name: id, notes: '偏学术、紧凑' })
console.log(`brief 长度：${brief.length} 字符，含字段表：${brief.includes('header.placement')}，含验收命令：${brief.includes('verify-render')}`)

const manifest = {
  id,
  label: 'DSH Test Timeline',
  header: { placement: 'sidebar', photo: 'left', band: false, align: 'center' },
  summary: 'featured',
  sidebar: { fill: true, width: 34, order: 'left' },
  title: 'caps',
  item: { marker: 'timeline', layout: 'stacked' },
  skills: { shape: 'bars' },
  page: { pageY: 15, pageX: 20, section: 2.8, item: 1.9 },
}

console.log('保存：', JSON.stringify(await saveCustomTemplate(config, manifest)))
const listed = await listCustomTemplates(config)
console.log('列表：', listed.map((row) => row.id).join(', '))

const store = createStore(config)
const all = ((await store.list()).resumes ?? [])
const resume = all[0] === undefined ? null : await store.get(all[0].id)
if (resume !== null && resume.error === undefined) {
  const manifests = await loadCustomTemplates(config)
  const html = renderResumeHtml(
    { ...resume.data, metadata: { ...(resume.data.metadata ?? {}), template: id } },
    { manifests },
  )
  console.log(`用自定义模板渲染：${html.length} 字节，skin 类=${/class="sheet skin-/.test(html)}，时间线=${html.includes('timeline')}`)
}

console.log('清理：', JSON.stringify(await deleteCustomTemplate(config, id)))
const ok =
  brief.includes('header.placement') &&
  listed.some((row) => row.id === id) &&
  (await listCustomTemplates(config)).every((row) => row.id !== id)
console.log(ok ? '\n模板流水线 ✓' : '\n模板流水线 ✗')
process.exitCode = ok ? 0 : 1
