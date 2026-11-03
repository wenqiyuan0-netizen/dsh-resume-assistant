/**
 * 兼容层：渲染实现已经拆到 `lib/render/`（tokens + manifests + compose）。
 *
 * 保留这个文件是为了让 `bridge.js` / `pdf.js` / `tools/*` 的 `import … from './render.js'`
 * 不用改；新代码请直接 import `./render/index.js`。
 *
 * @module dsh-resume-assistant/lib/render
 */
export { TEMPLATES, MANIFESTS, SECTION_LABEL, renderResumeHtml, safeFileName } from './render/index.js'
