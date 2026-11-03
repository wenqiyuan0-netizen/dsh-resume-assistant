/**
 * 给"做模板"的子 agent 拼提示词 —— 用代码生成，而不是每次手写。
 *
 * 为什么值得单独一段代码：这条流水线里，子 agent 需要知道的东西是**稳定**的
 * （manifest 字段、取值范围、验证命令、边界），只有"目标案例"和"命名"每次不同。
 * 把它们固化在这里，lead 只要给一段描述就能派活，子 agent 不会因为缺上下文而乱改渲染器。
 *
 * @module dsh-resume-assistant/lib/template-brief
 */
import { MANIFESTS } from './render/manifests.js'
import { TOKENS } from './render/tokens.js'

/** manifest 字段说明书（唯一真相：改这里就等于改对子 agent 的规范）。 */
const FIELD_SPEC = [
  ['id', '"acme-timeline"', '必填。小写+连字符，2–31 位；保存文件名就是它'],
  ['label', '"Acme Timeline"', '可选。给人看的名字'],
  ['header.placement', '"main" | "sidebar"', '页眉画在主栏还是侧栏（gengar 放侧栏）'],
  ['header.photo', '"none" | "left" | "right" | "side-top"', '照片位置；side-top = 侧栏顶部'],
  ['header.band', 'true | false', '页眉是否铺主色整幅色带（azurill 用它）'],
  ['header.align', '"left" | "center"', '页眉文字对齐'],
  ['summary', '"main" | "featured"', 'featured = 主栏顶部的强调块（gengar）'],
  ['sidebar.fill', 'true | false', '侧栏铺主色底'],
  ['sidebar.width', '18–48', '侧栏宽度百分比'],
  ['sidebar.order', '"left" | "right"', '侧栏在左还是右'],
  ['title', '"caps" | "underline" | "bar" | "chip" | "plain"', '栏目小标题装饰'],
  ['item.marker', '"none" | "dot" | "timeline"', '条目的左侧记号'],
  ['item.layout', '"stacked" | "inline"', '条目头是两行还是合并一行'],
  ['skills.shape', '"kv" | "bars" | "chips"', '技能呈现方式'],
  ['page', '{pageY,pageX,section,item}', '页边距/栏目间距/条目间距（mm）'],
  ['tokens', '{size,line,font,color}', '对基础刻度的局部覆盖'],
]

/**
 * 生成一份"做模板"的任务简报（可直接作为 subagent 的 prompt）。
 * @param options - `{ reference, name, notes }`。
 * @returns Markdown 文本。
 */
export function buildTemplateBrief(options = {}) {
  const reference = String(options.reference ?? '').trim()
  const name = String(options.name ?? '').trim()
  const notes = String(options.notes ?? '').trim()

  const fieldTable = FIELD_SPEC.map(([field, values, meaning]) => `| \`${field}\` | ${values} | ${meaning} |`).join('\n')
  const examples = ['onyx', 'gengar', 'azurill']
    .map((id) => {
      const manifest = MANIFESTS[id]
      return [
        `### 参考：内置 \`${id}\``,
        '```json',
        JSON.stringify(
          {
            id: manifest.id,
            header: manifest.header,
            summary: manifest.summary,
            sidebar: manifest.sidebar,
            title: manifest.title,
            item: manifest.item,
            skills: manifest.skills,
            page: manifest.page,
            tokens: manifest.tokens ?? {},
          },
          null,
          2,
        ),
        '```',
      ].join('\n')
    })
    .join('\n\n')

  return [
    '# 任务：把参考案例做成一个新模板（只写数据，不改代码）',
    '',
    reference === '' ? '参考案例：**未提供**（请向 lead 索取截图/PDF 路径或文字描述）' : `参考案例：${reference}`,
    name === '' ? '模板命名：由你提议一个（小写+连字符，例如 `acme-timeline`）' : `模板命名：\`${name}\``,
    notes === '' ? '' : `补充要求：${notes}`,
    '',
    '## 你产出的东西',
    '**一份 JSON manifest**（不是代码）。它由 `lib/render/compose.js` 消费，15 个内置模板也是同样的形状。',
    '保存后它会出现在简历面板的模板画廊里，并可按名字套用。',
    '',
    '## 字段规范（唯一允许的取值）',
    '| 字段 | 取值 | 含义 |',
    '|---|---|---|',
    fieldTable,
    '',
    '## 基础刻度（`tokens` 可局部覆盖）',
    '```json',
    JSON.stringify(TOKENS, null, 2),
    '```',
    '',
    examples,
    '',
    '## 硬性约束（违反就是不通过）',
    '1. **只提交 manifest JSON**；不要改 `lib/render/**`、不要新增模板专用 CSS 分支。',
    '2. 取值范围必须落在上表内；`id` 用小写 + 连字符。',
    '3. 不允许出现未知字段（会被 `validateManifest` 拒绝，见 `lib/templates-store.js`）。',
    '4. 描述结构差异时，写清是 `header` 位置、`sidebar` 填充、`title` 装饰、`item.marker` 中的哪一项造成的。',
    '',
    '## 验收方式（照做，别只看代码）',
    '```text',
    'node tools/verify-render.mjs --demo            # 15 个内置模板仍全部通过（不回退）',
    'node tools/verify-skins.mjs <resumeId>         # 装饰组合互不相同',
    '```',
    '然后用 `resume_template` 工具 `action=save` 落盘，`action=preview` 出一份 HTML，肉眼比对参考案例。',
    '',
    '## 汇报格式',
    '- 新模板 id + 一句话版式描述',
    '- 与参考案例逐项对照表（结构 / 主色用量 / 字号层级 / 条目形态）',
    '- 还有哪几项没对上（诚实列出，不要假装一致）',
  ]
    .filter((line) => line !== '')
    .join('\n')
}
