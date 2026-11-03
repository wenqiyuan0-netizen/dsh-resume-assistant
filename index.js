/**
 * dsh-resume-assistant —— 把本机的「简历助手」项目改装成 DSH 插件。
 *
 * 交付三件事：
 *   1. 8 个宿主工具（resume_service / doctor / list / show / patch / photo / export / new）；
 *   2. 一个 runtime skill（`resume-assistant`），正文随包走；
 *   3. 浏览器端两个座位：「简历」视图（放大编辑）+ 输入框下面那一排（只显示简历本身），
 *      数据走 `resume-bridge/*` 同源路由（见 lib/bridge.js）。
 *
 * **插件激活即拉起服务**：apply 里不等待启动完成（apply 是同步入口，也不能让插件
 * 激活卡 60 秒），而是排一个"稍后开始"的启动任务，由 service.start() 的 pending 去重
 * 保证与 resume_service(start) / UI 的「启动服务」并发时只真正跑一次。
 * 想关掉这个自动行为，把 config.autoStart 设成 false。
 *
 * @module dsh-resume-assistant
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { normalizeConfig } from './lib/config.js'
import { registerBridge } from './lib/bridge.js'
import { createRunner } from './lib/runner.js'
import { createServiceManager } from './lib/service.js'
import { createToolDefinitions } from './lib/tools.js'

/** Loader 里显示的插件名。 */
export const name = 'resume-assistant'

/** 只需要工具注册表与 skill 注册表；subprocess 走可选探测（见 lib/runner.js）。 */
export const inject = ['tools', 'skills']

/** 配置 schema（零依赖 Standard Schema v1，见 lib/config.js）。 */
export { Config } from './lib/config.js'

/** 绑定的 skill 名（kebab-case，模型用 `skill resume-assistant` 或 `/resume-assistant` 触发）。 */
const SKILL_NAME = 'resume-assistant'

/** 技能正文与其资源目录（相对本包）。 */
const SKILL_FILE_URL = new URL('./skills/resume-assistant/SKILL.md', import.meta.url)
const SKILL_DIR_URL = new URL('./skills/resume-assistant/', import.meta.url)

/** 常驻目录里展示的一行摘要。 */
const SKILL_DESCRIPTION = [
  '操控本机 Reactive Resume 简历工具（简历助手项目）：界面上可直接看/改简历，也能列简历、改模板/配色/字体/布局、填个人信息、上传照片、导出 PDF 到 04-输出。',
  '用于任何"改简历 / CV / Lebenslauf / resume / 换模板 / 换颜色 / 加照片 / 导 PDF"的请求，也用于该工具停止工作时的排障（服务没起、HTTP 401、数据库在恢复）。',
].join(' ')

/** 何时该加载它（模型可见的附加提示）。 */
const SKILL_WHEN_TO_USE = [
  '用户提到简历、CV、求职材料、投递用的 PDF，或提到"简历助手 / Reactive Resume / rr-cv"；',
  '或需要判断这台机器上简历工具当前是否可用。',
].join(' ')

/** 自动启动前的延迟：让插件树先挂完、UI 桥先就绪，再开始动数据库。 */
const AUTO_START_DELAY_MS = 1_500

/**
 * 把一个 skill 绑到插件上。
 *
 * `ctx.skills.register()` 的语义（registry 契约）：
 * - 落到**调用上下文所在层**：profile 里的插件行 → 全局层，所有会话可见；
 *   被某个 agent preset 的常驻组合挂载 → 只对该 preset 生效。
 * - 同层重名按 rank 决胜：项目 `.dsh\skills`(100) > runtime(250) > user(400) > bundled(600)。
 * - 正文不落盘也能加载：`content` 直接给字符串，`resourceBase` 指向包内目录，
 *   模型读 `references/...` 时用的就是这个绝对路径。
 *
 * @param ctx - 插件上下文（必须已注入 skills）。
 */
function registerSkill(ctx) {
  let content
  try {
    content = readFileSync(SKILL_FILE_URL, 'utf8')
  } catch (error) {
    // 正文缺失不该拖垮工具：工具照常可用，只是少了常驻说明书。
    ctx.logger?.warn?.(
      `resume-assistant: 读不到技能正文 ${String(SKILL_FILE_URL)}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }

  ctx.skills.register({
    name: SKILL_NAME,
    description: SKILL_DESCRIPTION,
    whenToUse: SKILL_WHEN_TO_USE,
    source: 'custom',
    provider: 'dsh-resume-assistant',
    resourceBase: { kind: 'directory', path: fileURLToPath(SKILL_DIR_URL) },
    invocation: { modelInvocable: true, userInvocable: true },
    content,
  })
}

/**
 * 排一次"随插件激活自动拉起服务"。
 *
 * 用 `ctx.effect` 管生命周期：它返回的 disposer 会清掉定时器与取消标记，
 * 插件卸载后即便还没到点也不会再启动任何进程。
 * @param ctx - 插件上下文。
 * @param service - 服务管理器。
 * @param config - 已归一化的配置。
 */
function scheduleAutoStart(ctx, service, config) {
  if (!config.autoStart) {
    ctx.logger?.info?.('resume-assistant: autoStart=false，不自动拉起服务')
    return
  }

  const schedule = () => {
    let cancelled = false
    const timer = setTimeout(() => {
      if (cancelled) return
      ctx.logger?.info?.(`resume-assistant: 自动拉起服务（${config.appUrl}）…`)
      service
        .start()
        .then((result) => {
          const state = result?.state ?? 'unknown'
          if (result?.ok) ctx.logger?.info?.(`resume-assistant: 服务就绪（${state}）`)
          else ctx.logger?.warn?.(`resume-assistant: 服务启动未完成（${state}）${result?.detail ? `：${result.detail}` : ''}`)
        })
        .catch((error) => {
          ctx.logger?.warn?.(`resume-assistant: 自动拉起服务失败：${error instanceof Error ? error.message : String(error)}`)
        })
    }, AUTO_START_DELAY_MS)
    // 不让这个定时器拖住进程退出
    timer.unref?.()

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }

  // 用 ctx.effect 管生命周期；裁剪过的组合没有 effect 时退化为"只排一次定时器"。
  if (typeof ctx.effect === 'function') ctx.effect(schedule, { label: 'resume-assistant: autoStart' })
  else schedule()
}

/**
 * 插件入口。
 * @param ctx - Cordis 上下文。
 * @param config - 插件行的 config（可为空，全部有默认值）。
 */
export function apply(ctx, config) {
  const resolved = normalizeConfig(config)
  const runner = createRunner(ctx, resolved)
  const service = createServiceManager(ctx, resolved)

  const definitions = createToolDefinitions({ config: resolved, runner, service })
  for (const definition of definitions) ctx.tools.register(definition)

  // 浏览器端插件的同源入口：简历视图 / 底部一排 通过它读状态、起服务、给 agent 发话。
  registerBridge(ctx, { config: resolved, service })

  registerSkill(ctx)
  scheduleAutoStart(ctx, service, resolved)

  ctx.logger?.info?.(
    `resume-assistant: 已注册 ${definitions.length} 个工具 + skill "${SKILL_NAME}" + UI 桥（应用 ${resolved.appUrl}）`,
  )
}
