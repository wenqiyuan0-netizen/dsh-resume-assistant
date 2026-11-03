/**
 * 本地验证脚本（不装插件也能跑）：
 *   1. 用桩上下文调用 apply()，抓出注册的工具定义与 skill 注册
 *   2. 用上游 dsh-tools 的强制 schema 子集校验 parameters / output
 *   3. 用 validateArgs 校验示例入参
 *   4. 真跑一条 resume_doctor（走 child_process 退路，不碰服务）
 *
 * 用法：node tools/verify-local.mjs [--live]
 */
import { pathToFileURL } from 'node:url'

const DSH_TOOLS =
  process.env.DSH_TOOLS_DIR ?? ''

const { assertSupportedJsonSchema, validateJsonSchemaValue } = await import(pathToFileURL(DSH_TOOLS).href).catch(
  (error) => {
    console.error(`无法加载 dsh-tools（schema 校验将跳过）：${error.message}`)
    return {}
  },
)

const plugin = await import('../index.js')

const registeredTools = []
const registeredSkills = []
const logs = []

const ctx = {
  tools: {
    register(definition) {
      registeredTools.push(definition)
      return () => {}
    },
  },
  skills: {
    register(skill) {
      registeredSkills.push(skill)
      return () => {}
    },
  },
  get() {
    return undefined // 故意不给 subprocess 服务：验证 child_process 退路
  },
  effect(callback) {
    const dispose = callback()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  logger: {
    info: (m) => logs.push(`info: ${m}`),
    warn: (m) => logs.push(`warn: ${m}`),
  },
}

let failures = 0
function check(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`)
  } else {
    failures += 1
    console.log(`  ✗ ${label}${detail === undefined ? '' : `\n      ${String(detail).replaceAll('\n', '\n      ')}`}`)
  }
}

console.log('== apply() ==')
plugin.apply(ctx, {})
console.log(logs.map((line) => `  ${line}`).join('\n'))
check('名字是 resume-assistant', plugin.name === 'resume-assistant', plugin.name)
check('inject 含 tools/skills', JSON.stringify(plugin.inject) === '["tools","skills"]', JSON.stringify(plugin.inject))
check('注册 10 个工具', registeredTools.length === 10, `实际 ${registeredTools.length}`)
check(
  '含 resume_dispatch',
  registeredTools.some((tool) => tool.name === 'resume_dispatch'),
  registeredTools.map((tool) => tool.name).join(','),
)
check('注册 1 个 skill', registeredSkills.length === 1, `实际 ${registeredSkills.length}`)

const skill = registeredSkills[0] ?? {}
check('skill 名 = resume-assistant', skill.name === 'resume-assistant', skill.name)
check('skill 有正文', typeof skill.content === 'string' && skill.content.length > 500, `${skill.content?.length} 字节`)
check('skill resourceBase 是目录', skill.resourceBase?.kind === 'directory', JSON.stringify(skill.resourceBase))
check('skill provider 标记正确', skill.provider === 'dsh-resume-assistant', skill.provider)
check(
  'skill 资源目录存在 SKILL.md',
  skill.resourceBase === undefined ||
    (await import('node:fs')).existsSync(`${skill.resourceBase.path}SKILL.md`),
  skill.resourceBase?.path,
)

console.log('\n== schema 子集校验 ==')
const samples = {
  resume_template: { action: 'list' },
  resume_service: { action: 'status' },
  resume_doctor: {},
  resume_list: {},
  resume_show: { resume: '张三' },
  resume_patch: {
    resume: 'zhangsan',
    operations: [{ op: 'replace', path: '/metadata/template', value: 'gengar' }],
  },
  resume_photo: { resume: 'zhangsan', image: 'C:\\tmp\\a.jpg' },
  resume_export: { resume: 'zhangsan', target: 'resume' },
  resume_new: { name: '张三', sample: true },
}

for (const definition of registeredTools) {
  const parametersOk = (() => {
    try {
      assertSupportedJsonSchema?.(definition.parameters)
      return undefined
    } catch (error) {
      return error.message
    }
  })()
  check(`${definition.name}: parameters 合法`, parametersOk === undefined, parametersOk)

  const outputOk = (() => {
    try {
      assertSupportedJsonSchema?.(definition.output?.schema)
      return undefined
    } catch (error) {
      return error.message
    }
  })()
  check(`${definition.name}: output 合法`, outputOk === undefined, outputOk)

  const argsSample = samples[definition.name]
  if (argsSample !== undefined) {
    const argsOk = (() => {
      const violations = validateJsonSchemaValue?.(definition.parameters, argsSample, '') ?? []
      return violations.length === 0 ? undefined : violations.join('; ')
    })()
    check(`${definition.name}: 示例入参通过`, argsOk === undefined, argsOk)
  }
}

console.log('\n== 缺参必须被拒 ==')
if (typeof validateJsonSchemaValue !== 'function') {
  console.log('  · 跳过（未找到 dsh-tools：把 DSH_TOOLS_DIR 指到它的 lib/index.js）')
}
for (const definition of typeof validateJsonSchemaValue === 'function' ? registeredTools : []) {
  const required = definition.parameters.required ?? []
  if (required.length === 0) continue
  const rejected = (validateJsonSchemaValue?.(definition.parameters, {}, '') ?? []).length > 0
  check(`${definition.name}: 空对象被拒（required=${required.join(',')}）`, rejected)
}

console.log('\n== Config（Standard Schema v1）==')
check('导出 Config', plugin.Config?.['~standard']?.version === 1, JSON.stringify(plugin.Config))
const validate = plugin.Config?.['~standard']?.validate
const emptyConfig = validate?.({})
check('空配置补默认值', emptyConfig?.issues === undefined && emptyConfig?.value?.timeoutMs === 180_000, JSON.stringify(emptyConfig))
const trimmed = validate?.({ projectRoot: '  C:\\tmp\\简历  ', nodePath: ' node ' })
check(
  '字符串去空白',
  trimmed?.value?.projectRoot === 'C:\\tmp\\简历' && trimmed?.value?.nodePath === 'node',
  JSON.stringify(trimmed),
)
check('拒绝负超时', (validate?.({ timeoutMs: -1 })?.issues ?? []).length === 1)
check('拒绝非字符串 nodePath', (validate?.({ nodePath: 5 })?.issues ?? []).length === 1)
check('拒绝非对象配置', (validate?.('nope')?.issues ?? []).length === 1)
check('保留未知键', validate?.({ extra: true })?.value?.extra === true)

console.log('\n== 输出渲染 ==')
for (const definition of registeredTools) {
  const blocks = definition.output.render({}, { text: 'hello' })
  check(
    `${definition.name}: render 返回 text 块`,
    Array.isArray(blocks) && blocks[0]?.type === 'text' && blocks[0].text === 'hello',
    JSON.stringify(blocks),
  )
}

if (process.argv.includes('--live')) {
  console.log('\n== 真跑 resume_doctor（child_process 退路）==')
  const doctor = registeredTools.find((definition) => definition.name === 'resume_doctor')
  const result = await doctor.execute({}, { signal: AbortSignal.timeout(120_000) })
  console.log(
    result.text
      .split('\n')
      .map((line) => `  │ ${line}`)
      .join('\n'),
  )
}

console.log(`\n${failures === 0 ? '全部通过 ✓' : `${failures} 项失败 ✗`}`)
process.exitCode = failures === 0 ? 0 : 1
