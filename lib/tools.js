/**
 * 工具定义。
 *
 * 直接提交**注册表契约**（标准 JSON Schema + execute/render），不用 `defineTool`：
 * `@deepseek-ai/dsh-tools` 是否可从 profile 插件裸 import 取决于 dsh-app-boot 的定制
 * 解析层，源码层判定不了。这个形状取自上游 `dsh-mcp-client` 的 `createMcpToolDefinition()`，
 * 是注册表原生契约，不是绕过。schema 只使用被强制支持的子集
 * （type / oneOf / properties / required / additionalProperties / items / enum / const + 注解）。
 *
 * @module dsh-resume-assistant/lib/tools
 */
import { randomUUID } from 'node:crypto'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describeConfig } from './config.js'
import { createStore } from './db.js'
import { runExport } from './export-job.js'
import { htmlToPdf } from './pdf.js'
import { renderResumeHtml } from './render/index.js'
import { buildTemplateBrief } from './template-brief.js'
import { deleteCustomTemplate, listCustomTemplates, loadCustomTemplates, saveCustomTemplate, validateManifest } from './templates-store.js'
import { buildEditBrief } from './worker-brief.js'

/** 所有工具共用的输出信封：一段给人看的文本。 */
const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      text: { type: 'string', description: '命令的完整输出（stdout 与 stderr 按顺序拼接）。' },
    },
    required: ['text'],
  },
  render: (_args, value) => [{ type: 'text', text: value.text }],
}

/** 空参数对象的 schema。 */
const NO_ARGS = { type: 'object', additionalProperties: false, properties: {} }

/**
 * 把 JSON Patch 操作序列写成 UTF-8（无 BOM）临时文件，跑完删掉。
 *
 * 这一步在插件里做掉，模型就不必再操心「PowerShell 引号把中文 JSON 弄坏」——
 * 那是这套脚本过去最容易翻车的地方。
 * @param operations - 待套用的操作数组。
 * @param run - 接收文件路径的回调。
 * @returns 回调结果。
 */
async function withOperationsFile(operations, run) {
  const file = join(tmpdir(), `dsh-rr-ops-${randomUUID()}.json`)
  await writeFile(file, JSON.stringify({ operations }), 'utf8')
  try {
    return await run(file)
  } finally {
    await unlink(file).catch(() => undefined)
  }
}

/**
 * 校验并取出操作数组。
 * @param value - 模型传入的 operations。
 * @returns 非空的操作数组。
 */
function assertOperations(value) {
  const operations = Array.isArray(value) ? value : value?.operations
  if (!Array.isArray(operations) || operations.length === 0) {
    throw new Error('operations 必须是至少含一条操作的数组（RFC 6902 JSON Patch）。')
  }
  for (const [index, operation] of operations.entries()) {
    if (operation === null || typeof operation !== 'object' || Array.isArray(operation)) {
      throw new Error(`operations[${index}] 不是对象。`)
    }
    if (typeof operation.op !== 'string' || operation.op === '') {
      throw new Error(`operations[${index}].op 缺失（add/remove/replace/move/copy/test）。`)
    }
    if (typeof operation.path !== 'string' || operation.path === '') {
      throw new Error(`operations[${index}].path 缺失，例如 "/metadata/template"。`)
    }
  }
  return operations
}

/**
 * 必填字符串参数。
 * @param value - 原始值。
 * @param name - 参数名（用于报错）。
 * @returns 去空白后的字符串。
 */
function required(value, name) {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`缺少参数 ${name}。`)
  return value.trim()
}

/**
 * 构建全部工具定义。
 * @param options - `{ config, runner, service }`。
 * @returns 可直接交给 `ctx.tools.register` 的定义数组。
 */
export function createToolDefinitions({ config, runner, service, ctx }) {
  return [
    {
      name: 'resume_template',
      description: [
        '做/存自定义模板（只写数据，不改代码）。action=list 看已保存的；action=brief 拿到一份可直接派给子 agent 的完整任务简报（字段规范/取值/约束/验收/汇报格式都拼好）；',
        'action=save 校验并落盘一份 manifest；action=preview 用某份模板渲染样张；action=delete 删除。',
        '用法：先 brief（把返回文本原样交给子 agent，让它产出 manifest JSON），再 save，再 preview 肉眼比对参考案例。',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', enum: ['list', 'brief', 'save', 'preview', 'delete'], description: '要做什么' },
          reference: { type: 'string', description: 'brief 用：参考案例（截图路径 / PDF 路径 / 文字描述）' },
          name: { type: 'string', description: 'brief 或 save 用：模板 id（小写+连字符）' },
          notes: { type: 'string', description: 'brief 用：额外要求' },
          manifest: { type: 'object', additionalProperties: true, description: 'save 用：manifest JSON' },
          resume: { type: 'string', description: 'preview 用：拿哪份简历做样张' },
          template: { type: 'string', description: 'preview 用：模板 id（默认取 name）' },
        },
        required: ['action'],
      },
      output: OUTPUT,
      async execute(args) {
        const action = String(args?.action ?? 'list')
        if (action === 'list') {
          const custom = await listCustomTemplates(config)
          return {
            text: custom.length === 0 ? '（还没有自定义模板）' : custom.map((row) => `- ${row.id}  ${row.label}`).join('\n'),
          }
        }
        if (action === 'brief') {
          return { text: buildTemplateBrief({ reference: args?.reference, name: args?.name, notes: args?.notes }) }
        }
        if (action === 'save') {
          const manifest = args?.manifest ?? {}
          const checked = validateManifest(manifest)
          if (checked.ok !== true) return { text: `manifest 不通过：\n- ${checked.errors.join('\n- ')}` }
          const saved = await saveCustomTemplate(config, manifest)
          return { text: saved.error !== undefined ? `保存失败：${saved.error}` : `已保存模板 ${manifest.id} → ${saved.path}` }
        }
        if (action === 'delete') {
          const id = String(args?.name ?? '')
          if (id === '') return { text: 'delete 需要 name（模板 id）' }
          const removed = await deleteCustomTemplate(config, id)
          return { text: removed.error !== undefined ? `删除失败：${removed.error}` : `已删除 ${id}` }
        }
        const store = createStore(config)
        const resume = await store.get(String(args?.resume ?? ''))
        if (resume.error !== undefined) return { text: `preview 失败：${resume.error}` }
        const template = String(args?.template ?? args?.name ?? '')
        const manifests = await loadCustomTemplates(config)
        const doc = { ...resume.data, metadata: { ...(resume.data?.metadata ?? {}), template } }
        const html = renderResumeHtml(doc, { manifests })
        const printed = await htmlToPdf(html, join(config.outputDir, '_templates', `preview-${template || 'unnamed'}.pdf`))
        return {
          text: [
            `模板：${template}`,
            `样张 HTML 已生成（${html.length} 字节）`,
            printed.ok === true ? `PDF：${printed.path}` : `PDF 未生成（${printed.reason ?? '未知'}）`,
          ].join('\n'),
        }
      },
    },
    {
      name: 'resume_dispatch',
      description: [
        '把简历的编辑/排版/美化任务派给一个**不带对话上下文**的「简历助手」子 agent，由它去改简历。',
        '你自己**不要排版**、不要为了排版直接 resume_patch：你只负责填槽 ——',
        'intent（用户要什么）、resumeId、paths（目标 JSON Pointer）、excerpt（要写成的原话，原样传下去）。',
        '子 agent 会自己 resume_show 读全文、只改这些 path、改完复核，然后用完成通知把"改了哪些 path"回给你；',
        '你收到通知后再向用户汇报。用户只是提问、不改东西时，不要调用本工具。',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          intent: { type: 'string', description: '用户要什么（一句话，不要复述整段对话）' },
          resumeId: { type: 'string', description: '目标简历 id（resume_list 或面板里那个）' },
          paths: {
            type: 'array',
            items: { type: 'string' },
            description: '目标字段的 JSON Pointer，如 /sections/experience/items/2；不填则由子 agent 按诉求定位',
          },
          excerpt: { type: 'string', description: '要写成的具体文本/事实（原样传给子 agent，不要改写）' },
          constraints: { type: 'string', description: '额外约束（可空）' },
          label: { type: 'string', description: '子 agent 标签，默认 resume-edit（便于在子 agent 列表里认出来）' },
        },
        required: ['intent'],
      },
      output: OUTPUT,
      async execute(args, exec) {
        const parent = exec?.agent
        if (parent === undefined || parent === null) {
          return { text: 'resume_dispatch 需要一个调用方 agent（exec.agent 为空），这次派不出去。' }
        }
        const subagents = ctx?.get?.('subagents')
        if (subagents === undefined || typeof subagents.startActivation !== 'function') {
          return { text: '宿主没有 subagents 服务（dsh-subagent 未挂载）：这次任务要么你自己用 resume_patch 做完，要么让用户装回 subagent。' }
        }
        const label = String(args?.label ?? '').trim() || 'resume-edit'
        const brief = buildEditBrief({
          intent: args?.intent,
          resumeId: args?.resumeId,
          paths: args?.paths,
          excerpt: args?.excerpt,
          constraints: args?.constraints,
        })
        try {
          const activation = await subagents.startActivation({
            provider: 'spawn',
            label,
            request: { parent, prompt: [{ type: 'text', text: brief }] },
            // 必填：manager 第一件事就是 spec.signal.throwIfAborted()（少传就是 "reading 'throwIfAborted'"）
            signal: exec?.signal ?? new AbortController().signal,
            delivery: 'parent',
          })
          return {
            text: [
              `已派给「简历助手」子 agent：${activation.childId}（label: ${label}）`,
              '它没有对话上下文，只拿到：意图 + 目标 path + 要写成的原话。',
              '它结算后会有一条完成通知；届时把"改了哪些 path、每处改了什么"汇总给用户，不要自己再改一遍。',
            ].join('\n'),
          }
        } catch (error) {
          return { text: `派发失败：${error instanceof Error ? error.message : String(error)}` }
        }
      },
    },
    {
      name: 'resume_service',
      description: [
        '简历服务的开关与状态：action=start 启动 PostgreSQL + 应用，action=stop 全部停止，action=status 只查不动。',
        'start 是幂等的：已经在跑就直接返回 already-running。它由宿主插件进程直接拉起（pg_ctl + detached node），',
        '不是沙箱里的临时进程，所以不会随工具调用结束被杀掉 —— 这就是"agent 自己能起服务"的那条路。',
        '服务没跑时（resume_doctor 报「服务未运行」）先调它，别让用户手动双击 bat。',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: {
            type: 'string',
            enum: ['start', 'stop', 'status'],
            description: 'start 启动 / stop 停止 / status 只读状态。',
          },
        },
        required: ['action'],
      },
      output: OUTPUT,
      async execute(args) {
        const action = typeof args?.action === 'string' ? args.action : 'status'
        const result =
          action === 'start' ? await service.start() : action === 'stop' ? await service.stop() : await service.status()
        const lines = [`action = ${action}`, `state  = ${result.state ?? (result.running ? 'running' : 'stopped')}`]
        for (const step of result.steps ?? []) lines.push(`  · ${step}`)
        if (result.detail !== undefined && result.detail !== '') lines.push(`\n日志尾部：\n${result.detail}`)
        if (result.appUrl !== undefined) lines.push(`appUrl = ${result.appUrl}`)
        if (result.pid !== undefined && result.pid !== null) lines.push(`pid    = ${result.pid}`)
        return { text: lines.join('\n') }
      },
    },
    {
      name: 'resume_doctor',
      description: [
        '自检本机简历助手（Reactive Resume + 便携版 PostgreSQL）：钥匙文件、输出目录、服务是否在跑、MCP 鉴权是否通过。',
        '任何简历操作之前先跑这一条。若报告「服务未运行」，直接调 resume_service(start) 把服务拉起来，再重跑一次。',
      ].join(' '),
      parameters: NO_ARGS,
      output: OUTPUT,
      async execute(_args, exec) {
        const result = await runner.run(['doctor'], exec)
        return { text: `${describeConfig(config)}\n\n${'='.repeat(46)}\n${result.text}` }
      },
    },
    {
      name: 'resume_list',
      description: '列出本机所有简历（名字、id、slug、更新时间）。需要挑一份简历改的时候先跑它。',
      parameters: NO_ARGS,
      output: OUTPUT,
      async execute(_args, exec) {
        const result = await runner.run(['list'], exec)
        return { text: result.text }
      },
    },
    {
      name: 'resume_show',
      description: [
        '看一份简历的**紧凑概要**：模板、主色、字体、纸张、分页布局、可见栏目、头像状态。',
        '默认只给决策需要的字段（省 token）；只有确实要改深层结构时才传 full=true 拿完整 JSON。',
        'resume 参数可传完整 id、id 前缀、slug 或简历名字。',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resume: { type: 'string', description: '简历的 id / id 前缀 / slug / 名字。' },
          full: { type: 'boolean', description: 'true 时返回完整 JSON（很大，慎用）。' },
        },
        required: ['resume'],
      },
      output: OUTPUT,
      async execute(args, exec) {
        const resume = required(args?.resume, 'resume')
        const argv = ['show', resume]
        if (args?.full === true) argv.push('--full')
        const result = await runner.run(argv, exec)
        return { text: result.text }
      },
    },
    {
      name: 'resume_patch',
      description: [
        '用 RFC 6902 JSON Patch 改简历的样式或内容（模板、主色、字体、字号、页边距、语言、布局、姓名、简介、各栏目条目等），一次可传多条。',
        'operations 示例：[{"op":"replace","path":"/metadata/template","value":"gengar"},{"op":"replace","path":"/metadata/design/colors/primary","value":"rgba(37,99,235,1)"}]。',
        '中文直接写在 value 里即可（插件负责写 UTF-8 无 BOM 临时文件，不要再走命令行传 JSON）。',
        '改之前先用 resume_show 确认真实结构：replace 要求路径已存在，新路径用 add；头像在顶层 /picture/url，不是 /basics/picture/url。',
        '只改叶子路径：不要用 replace 整块替换 /sections 下的栏目或 items 数组，也不要用记忆里的旧内容重建条目 —— 用户在面板里手改过的文字会被覆盖。',
        '每次 patch 会自动在 04-输出\\_backup 留一份改前备份，并回报"不在本次操作路径内"的变动；还原历史用 03-脚本: node rr-cv.mjs history / restore。',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resume: { type: 'string', description: '简历的 id / id 前缀 / slug / 名字。' },
          operations: {
            type: 'array',
            items: { type: 'object', additionalProperties: true },
            description: 'RFC 6902 操作数组，每项含 op（add/remove/replace/move/copy/test）、path，以及 add/replace 需要的 value。',
          },
        },
        required: ['resume', 'operations'],
      },
      output: OUTPUT,
      async execute(args, exec) {
        const resume = required(args?.resume, 'resume')
        const operations = assertOperations(args?.operations)
        return await withOperationsFile(operations, async (file) => {
          const result = await runner.run(['patch', resume, file], exec)
          return { text: result.text }
        })
      },
    },
    {
      name: 'resume_photo',
      description: [
        '给简历上传一张本地图片并写入 /picture/url（顺带把头像显隐设为 false）。',
        'image 必须是指向本机图片的绝对路径（jpg/png/webp）。一步到位，不用先手动上传。',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resume: { type: 'string', description: '简历的 id / id 前缀 / slug / 名字。' },
          image: { type: 'string', description: '本机图片的绝对路径。' },
        },
        required: ['resume', 'image'],
      },
      output: OUTPUT,
      async execute(args, exec) {
        const resume = required(args?.resume, 'resume')
        const image = required(args?.image, 'image')
        const result = await runner.run(['photo', resume, image], exec)
        return { text: result.text }
      },
    },
    {
      name: 'resume_export',
      description: [
        '把简历导出成 PDF，落到 04-输出\\<folder>\\<文件名>，逐页生成 .png 截图，自动更新 04-输出\\_索引.md，最后打印绝对路径。',
        '导出复用面板预览那套渲染（模板/字体/页边距/照片位置逐页一致）；打印用本机 Chrome/Edge 的无头模式，不需要 Electron。',
        '返回里会说明共几页、多少 KB、是否覆盖了旧文件、截图在哪；reveal: true 时顺手在资源管理器里选中那份 PDF。',
        '导出后要把绝对路径原样回给用户，并 read_image 核对截图（头像位置、有没有串页）。',
      ].join(' '),
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          resume: { type: 'string', description: '简历的 id / id 前缀 / slug / 名字。' },
          folder: { type: 'string', description: '04-输出 下的子文件夹名（默认取简历的名字）。' },
          filename: { type: 'string', description: 'PDF 文件名（默认 <folder>-CV.pdf）。' },
          target: {
            type: 'string',
            enum: ['resume', 'cover-letter'],
            description: '导出简历正文（默认，走预览同款渲染）或求职信（走 Reactive Resume 老路）。',
          },
          reveal: {
            type: 'boolean',
            description: 'true 时导出后在资源管理器里选中这个 PDF。默认 false（批量导出时不该弹一堆窗口）。',
          },
        },
        required: ['resume'],
      },
      output: OUTPUT,
      async execute(args, exec) {
        const ref = required(args?.resume, 'resume')

        // 求职信不是本渲染器能出的（Reactive Resume 的 cover-letter 与简历是两套模板），
        // 退回 rr-cv.mjs 的 download_resume_pdf 老路。
        if (args?.target === 'cover-letter') {
          const result = await runner.run(['export', ref, '--target', 'cover-letter'], exec)
          return { text: result.text }
        }

        // 与面板的「导出 PDF」走同一条实现：渲染 → 打印 → 索引 →（可选）选中文件。
        const store = createStore(config)
        const exported = await runExport({
          config,
          store,
          ref,
          folder: args?.folder?.trim() || undefined,
          filename: args?.filename?.trim() || undefined,
          overwrite: 'overwrite',
          screenshots: true,
          reveal: args?.reveal === true,
        })
        if (exported.ok !== true) return { text: `导出失败：${exported.reason ?? '未知原因'}` }

        return {
          text: [
            `PDF 已导出：${exported.path}`,
            `共 ${exported.pages} 页 · ${Math.round(exported.bytes / 1024)} KB · ${exported.overwrote ? '已覆盖旧文件' : '新文件'}`,
            exported.screenshots?.length > 0 ? `截图（核排版）：${exported.screenshots.join('、')}` : '',
            // 打开文件夹不是"点了就算"：走了哪条路、成没成功，都写出来。
            args?.reveal === true
              ? exported.revealed
                ? `已在资源管理器里选中它（${exported.reveal?.method}）`
                : `资源管理器没打开：${exported.reveal?.detail ?? '原因未知'}`
              : '',
            exported.index,
          ]
            .filter(Boolean)
            .join('\n'),
        }
      },
    },
    {
      name: 'resume_new',
      description: '新建一份空简历（可选带示例数据、指定模板）。名字含中文时直接写在 name 里即可。',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', description: '简历名字，例如 "张三"。' },
          slug: { type: 'string', description: 'URL slug（默认取 name）。' },
          sample: { type: 'boolean', description: 'true 时填入示例数据。' },
          template: {
            type: 'string',
            description: '模板名，例如 gengar / pikachu / onyx / azurill（共 15 个）。',
          },
        },
        required: ['name'],
      },
      output: OUTPUT,
      async execute(args, exec) {
        const name = required(args?.name, 'name')
        const argv = ['new', name]
        if (typeof args?.slug === 'string' && args.slug.trim() !== '') argv.push('--slug', args.slug.trim())
        if (args?.sample === true) argv.push('--sample')
        if (typeof args?.template === 'string' && args.template.trim() !== '') {
          argv.push('--template', args.template.trim())
        }
        const result = await runner.run(argv, exec)
        return { text: result.text }
      },
    },
  ]
}