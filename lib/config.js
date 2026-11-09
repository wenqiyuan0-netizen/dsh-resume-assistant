/**
 * 配置归一化。
 *
 * 为什么自己归一化、不导出 schemastery：
 * profile 插件以本地目录安装（pnpm link）时，裸 import `@deepseek-ai/*` 会从包的
 * **实体路径** 向上解析，找不到 profile 的 node_modules —— 能否解析取决于
 * dsh-app-boot 的定制解析层，源码层无法判定。零 import 是唯一稳的做法。
 *
 * @module dsh-resume-assistant/lib/config
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 本机简历助手的默认根目录。 */
export const DEFAULT_PROJECT_ROOT =
  process.env.RESUME_ASSISTANT_HOME ?? join(homedir(), 'Documents', '简历助手')

/** 单次脚本调用的默认超时（导出 PDF 可能慢，给足 3 分钟）。 */
export const DEFAULT_TIMEOUT_MS = 180_000

/** 应用地址与健康检查。 */
const APP_PORT = 3000
const HEALTH_PATH = '/api/health'

/** 脚本目录相对项目根的默认位置。 */
const SCRIPT_DIR_NAME = '03-脚本'

/**
 * 取一个非空字符串配置值。
 * @param value - 原始值。
 * @returns 去过首尾空白的字符串，或 undefined。
 */
function text(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * 把插件行里的原始 config 整理成运行期配置。
 * @param raw - Loader 传入的 config（可能为空对象）。
 * @returns 完整配置；任何非法/缺失字段回落到默认值，不抛错。
 */
export function normalizeConfig(raw) {
  const input = raw !== null && typeof raw === 'object' ? raw : {}
  const projectRoot = text(input.projectRoot) ?? DEFAULT_PROJECT_ROOT
  const scriptDir = text(input.scriptDir) ?? join(projectRoot, SCRIPT_DIR_NAME)
  const nodePath = text(input.nodePath) ?? 'node'
  const timeoutMs =
    Number.isFinite(input.timeoutMs) && input.timeoutMs > 0 ? Math.floor(input.timeoutMs) : DEFAULT_TIMEOUT_MS
  const appPort = Number.isFinite(input.appPort) && input.appPort > 0 ? Math.floor(input.appPort) : APP_PORT
  const appUrl = text(input.appUrl) ?? `http://localhost:${appPort}`
  const autoStart = typeof input.autoStart === 'boolean' ? input.autoStart : true

  return Object.freeze({
    projectRoot,
    scriptDir,
    nodePath,
    timeoutMs,
    appPort,
    appUrl,
    autoStart,
    healthUrl: `${appUrl}${HEALTH_PATH}`,
    /** `03-脚本\rr-cv.mjs` 的绝对路径。 */
    scriptPath: join(scriptDir, 'rr-cv.mjs'),
    /** 产出目录（仅用于文案，实际写入由 rr-cv.mjs 负责）。 */
    outputDir: join(projectRoot, '04-输出'),
    /** 经历库目录（`06-经历库\experiences.json`，由 lib/experiences.js 读写）。 */
    experiencesDir: join(projectRoot, '06-经历库'),
    /** PostgreSQL 便携版程序目录与数据目录。 */
    pgBin: join(projectRoot, '02-数据库', 'pg', 'pgsql', 'bin'),
    pgData: join(projectRoot, '02-数据库', 'pgdata'),
    pgLog: join(projectRoot, '02-数据库', 'pg.log'),
    /** 应用服务入口与日志。 */
    appDir: join(projectRoot, '01-应用', 'reactive-resume'),
    serverEntry: join(projectRoot, '01-应用', 'reactive-resume', 'apps', 'server', 'dist', 'index.mjs'),
    serverLog: join(projectRoot, '02-数据库', 'server.log'),
    databaseUrl: 'postgresql://postgres:postgres@localhost:5432/postgres',
  })
}

/**
 * 一行紧凑的配置自述，供自检工具回显。
 * @param config - 已归一化的配置。
 * @returns 多行文本。
 */
export function describeConfig(config) {
  return [
    `projectRoot = ${config.projectRoot}`,
    `scriptDir   = ${config.scriptDir}`,
    `script      = ${config.scriptPath}`,
    `app         = ${config.appUrl}（入口 ${config.serverEntry}）`,
    `node        = ${config.nodePath}`,
    `timeoutMs   = ${config.timeoutMs}`,
    `experiences = ${config.experiencesDir ?? join(config.projectRoot, '06-经历库')}`,
  ].join('\n')
}

const VENDOR = 'dsh-resume-assistant'

/**
 * 把任意值渲染成日志里读得懂的短形式。
 * @param value - 任意值。
 * @returns 短描述。
 */
function describe(value) {
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return String(value)
}

/** 字符串型配置字段。 */
const STRING_FIELDS = ['projectRoot', 'scriptDir', 'nodePath', 'appUrl']

/**
 * 配置 schema —— 零依赖的 Standard Schema v1 实现。
 *
 * Cordis 的 `resolveConfig` 契约只有三条：看 `runtime.Config`、
 * 同步调 `Config['~standard'].validate(config)`、拿 `{ value }` 或 `{ issues }`。
 *
 * 校验失败会让整个插件行激活失败，所以这里的口径是「只在真错的时候报」：
 * 未知键保留不报错（向前兼容），已知键类型不对才 `issues`。
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: VENDOR,
    /**
     * @param value - 加载器传入的原始配置；未配置时是 `undefined` 或 `{}`。
     * @returns `{ value }`（含补全的默认值）或 `{ issues }`。
     */
    validate(value) {
      if (value !== undefined && (value === null || typeof value !== 'object' || Array.isArray(value))) {
        return { issues: [{ message: `${VENDOR} config must be an object, got ${describe(value)}` }] }
      }

      const input = value ?? {}
      const issues = []

      for (const field of STRING_FIELDS) {
        const raw = input[field]
        if (raw === undefined) continue
        if (typeof raw !== 'string' || raw.trim() === '') {
          issues.push({ message: `$.${field} expected a non-empty string but got ${describe(raw)}`, path: [field] })
        }
      }

      const timeoutMs = input.timeoutMs
      if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
        issues.push({
          message: `$.timeoutMs expected a positive finite number but got ${describe(timeoutMs)}`,
          path: ['timeoutMs'],
        })
      }

      const appPort = input.appPort
      if (appPort !== undefined && (!Number.isInteger(appPort) || appPort <= 0 || appPort > 65535)) {
        issues.push({ message: `$.appPort expected a port number but got ${describe(appPort)}`, path: ['appPort'] })
      }

      const autoStart = input.autoStart
      if (autoStart !== undefined && typeof autoStart !== 'boolean') {
        issues.push({ message: `$.autoStart expected a boolean but got ${describe(autoStart)}`, path: ['autoStart'] })
      }

      if (issues.length > 0) return { issues }

      return {
        value: {
          ...input,
          projectRoot: text(input.projectRoot) ?? DEFAULT_PROJECT_ROOT,
          ...(text(input.scriptDir) !== undefined ? { scriptDir: text(input.scriptDir) } : {}),
          nodePath: text(input.nodePath) ?? 'node',
          ...(text(input.appUrl) !== undefined ? { appUrl: text(input.appUrl) } : {}),
          timeoutMs: Number.isFinite(timeoutMs) ? Math.floor(timeoutMs) : DEFAULT_TIMEOUT_MS,
          ...(Number.isInteger(appPort) ? { appPort } : {}),
          autoStart: typeof autoStart === 'boolean' ? autoStart : true,
        },
      }
    },
  },
}
