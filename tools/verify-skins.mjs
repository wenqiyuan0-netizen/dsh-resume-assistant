/**
 * manifest 驱动自检：确认 15 个模板的**装饰确实不同**（不是换名字），
 * 并且每个模板都能用真实简历渲染出照片与分页。
 *
 *   node tools/verify-skins.mjs <resumeId>
 */
import { normalizeConfig } from '../lib/config.js'
import { createStore } from '../lib/db.js'
import { MANIFESTS, TEMPLATES, renderResumeHtml } from '../lib/render/index.js'

const store = createStore(normalizeConfig({}))
const id = process.argv[2]
const resume = await store.get(id)
if (resume.error !== undefined) {
  console.log(`读取失败：${resume.error}`)
  process.exit(1)
}

const data = resume.data
console.log(`简历：${resume.name}\n`)

const pad = (value, width) => String(value).padEnd(width)
console.log(
  pad('template', 12) + pad('title', 11) + pad('marker', 10) + pad('skills', 8) + pad('band', 6) + pad('side&fill', 11) + pad('sheets', 7) + 'bytes',
)
let problems = 0
for (const template of TEMPLATES) {
  const manifest = MANIFESTS[template]
  const html = renderResumeHtml({ ...data, metadata: { ...(data.metadata ?? {}), template } })
  const sheets = (html.match(/class="sheet /g) ?? []).length
  const hasPhoto = html.includes('class="ph"')
  const hasBand = /class="hd[^"]*\bband\b/.test(html)
  if (sheets === 0) problems += 1
  console.log(
    pad(template, 12) +
      pad(manifest.title, 11) +
      pad(manifest.item?.marker ?? 'none', 10) +
      pad(manifest.skills?.shape ?? 'kv', 8) +
      pad(hasBand ? '✓' : '·', 6) +
      pad(`${manifest.sidebar?.order}/${manifest.sidebar?.fill ? 'fill' : '-'}`, 11) +
      pad(sheets, 7) +
      html.length +
      (hasPhoto ? '' : '  ⚠ 无照片'),
  )
}

const shapes = new Set(TEMPLATES.map((template) => JSON.stringify([MANIFESTS[template].title, MANIFESTS[template].item?.marker, MANIFESTS[template].skills?.shape])))
console.log(`\n不同的装饰组合：${shapes.size}/15；渲染异常：${problems}`)
process.exitCode = problems === 0 ? 0 : 1
