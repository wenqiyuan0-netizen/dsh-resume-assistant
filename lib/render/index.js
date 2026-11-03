/**
 * 渲染层的公开入口（对外只暴露这三个名字）。
 *
 * 结构：tokens（刻度）→ manifests（15 份数据）→ compose（唯一渲染器）。
 * 加一个模板 = 在 manifests.js 里加一份数据；改一处排版 = 改 tokens.js。
 *
 * @module dsh-resume-assistant/lib/render
 */
export { TEMPLATE_IDS as TEMPLATES, MANIFESTS, manifestOf, SIDE_KINDS, MAIN_KINDS } from './manifests.js'
export { TOKENS, resolveTokens } from './tokens.js'
export { SECTION_LABEL, renderResumeHtml, renderSection, safeFileName } from './compose.js'
