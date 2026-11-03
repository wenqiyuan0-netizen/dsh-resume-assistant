/**
 * 子 agent 的任务书。
 *
 * 两条铁律，都来自「不把简历细节塞进主对话」这个前提：
 *   1. 子 agent **不继承对话上下文**（`spawn` 而不是 `fork`），所以任务书必须自包含：
 *      读什么、改哪里、原话是什么、怎么验收、回什么格式。
 *   2. 任务书由**代码**拼，不由模型现编。模型只负责填槽（意图/路径/原话/约束），
 *      这样提示词可评审、可回归测试，也不会因为模型漏写而让子 agent 自由发挥。
 *
 * @module dsh-resume-assistant/lib/worker-brief
 */
import { buildTemplateBrief } from './template-brief.js'

/** 常量级约束：每条任务书都带，避免模型"顺手"改事实。 */
const BASE_RULES = [
  '事实一个都不许改：公司、职位、时间、学历、证书、数字、人名、联系方式。只改表达与排版。',
  '不要动模板、配色、分页、照片（除非诉求明确要求）。',
  '不要粘贴整份文档，不要输出 HTML，不要解释过程。',
]

/**
 * 编辑类任务书：给一个没有对话历史的简历助手。
 * @param options - 见下方字段。
 * @param options.intent - 用户要什么（一句话，来自 lead）。
 * @param options.resumeId - 目标简历 id。
 * @param options.paths - 目标 JSON Pointer 列表（可空：由子 agent 按诉求自行定位）。
 * @param options.excerpt - 用户要写成的具体文本/事实，原样保留。
 * @param options.constraints - 额外约束（可空）。
 * @returns 可直接作为 `spawn` 子 agent 的 prompt 的文本。
 */
export function buildEditBrief({ intent, resumeId, paths, excerpt, constraints } = {}) {
  const id = String(resumeId ?? '').trim()
  const goal = String(intent ?? '').trim()
  const pathList = Array.isArray(paths) ? paths.map((path) => String(path).trim()).filter(Boolean) : []
  const text = String(excerpt ?? '').trim()
  const extra = String(constraints ?? '').trim()

  const lines = [
    '你是「简历助手」：只做简历的排版与措辞打磨。你没有对话历史，下面就是全部输入。',
    '',
    '## 输入',
    id === '' ? '- 简历 id：（未指定，先用 resume_list 找到唯一匹配的那份）' : `- 简历 id：${id}`,
    `- 用户诉求：${goal === '' ? '（未写，按目标 path 做最小必要改动）' : goal}`,
    pathList.length === 0
      ? '- 目标字段：未指定 —— 自己按诉求定位，只改必要的那几处'
      : ['- 目标字段（JSON Pointer）：', ...pathList.map((path) => `  - ${path}`)].join('\n'),
    text === ''
      ? '- 要写成的具体内容：未提供 —— 措辞由你打磨，但事实不许变'
      : ['- 要写成的具体内容（原样使用，不要改写成别的说法）：', '```', text, '```'].join('\n'),
  ]
  if (extra !== '') lines.push(`- 额外约束：${extra}`)
  lines.push(
    '',
    '## 怎么做',
    '1. `resume_show` 读全文，看清结构与你目标的 path；不要整份回显。',
    '2. 只改目标 path。写回用 `resume_patch`（JSON Patch）或 `local/update`（整块 partial）；改完再 `resume_show` 复核一次。',
    '3. 一次改不完就分多次 patch，不要留半成品。',
    '',
    '## 硬约束',
    ...BASE_RULES.map((rule) => `- ${rule}`),
    '',
    '## 你要回的（≤200 字）',
    '- 改了哪些 path（逐条）',
    '- 每条改了什么（一句）',
    '- 有没有需要用户拍板的取舍',
  )
  return lines.join('\n')
}

/**
 * 做模板的任务书：在 `resume_template(action=brief)` 的任务书后面追加"看图"的硬要求。
 *
 * 为什么不让模型只把路径转述一遍：子 agent 拿到的是**路径**而不是 image part，
 * 它必须自己 `read_image` 才真看见图；不写死这一步，它就会凭想象编版式。
 * @param options - `{ imagePath, notes, name }`。
 * @returns 子 agent 的完整任务书。
 */
export function buildTemplateTask({ imagePath, notes, name } = {}) {
  const path = String(imagePath ?? '').trim()
  const brief = buildTemplateBrief({ reference: path, name, notes })
  return [
    brief,
    '',
    '## 关于参考图（硬要求）',
    path === '' ? '- 没有给参考图：按文字描述做。' : `- 参考图在本地：${path}`,
    '- 先 `read_image` 打开这张图看清楚再动手：栏位划分、字号层级、留白比例、强调色、装饰元素。',
    '- 不要凭想象编版式；做完必须 `resume_template(action=preview)` 出一次样张自检。',
    '- 完成后只回：`模板 id` + 逐项对照（照着图说哪几项对上了、哪项做了取舍）。',
  ].join('\n')
}
