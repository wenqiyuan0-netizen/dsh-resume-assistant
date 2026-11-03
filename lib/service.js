/**
 * 简历服务的生命周期管理（数据库 + 应用）。
 *
 * 为什么现在可以由 agent 拉起：以前那条"绝不自动启动"的铁律，原因是
 * **沙箱里的工具调用** spawn 出来的东西会随命令结束被连带杀掉，导致 PostgreSQL
 * 反复崩溃恢复。这里的 spawn 发生在 **Host 插件进程**（Electron 主进程，长期存活）
 * 里，不属于任何一次工具调用：postgres 经 `pg_ctl` 正确脱离进程树，应用服务
 * `detached + unref`，两者都在工具调用结束之后继续活着。
 *
 * 步骤与 `03-脚本\启动简历工具.bat` 完全一致（pg_ctl start → 等 pg_isready →
 * node server → 等 /api/health），所以手工按钮和这里不会有两套语义。
 *
 * @module dsh-resume-assistant/lib/service
 */
import { execFile, spawn } from 'node:child_process'
import { openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { promisify } from 'node:util'

import { ensureBridgeScript, ensureEmbeddable } from './patch-app.js'
import { publishBridgeScript } from './assets.js'

const execFileAsync = promisify(execFile)

const PG_ISREADY_TIMEOUT_MS = 40_000
const APP_TIMEOUT_MS = 60_000
const POLL_MS = 1_000

/** 等一小会儿。 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 轮询直到条件成立或超时。
 * @param check - 返回 Promise<boolean> 的检查。
 * @param timeoutMs - 超时。
 * @returns 是否在超时前成立。
 */
async function waitFor(check, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(POLL_MS)
  }
  return false
}

/**
 * 读取日志尾部若干行（失败时给人看的线索）。
 * @param path - 日志路径。
 * @param lines - 末尾行数。
 * @returns 文本；读不到时给空串。
 */
function logTail(path, lines = 12) {
  try {
    const text = readFileSync(path, 'utf8')
    return text.trimEnd().split(/\r?\n/).slice(-lines).join('\n')
  } catch {
    return ''
  }
}

/**
 * 创建服务管理器。
 * @param ctx - 插件上下文（用来解析 node 可执行文件）。
 * @param config - 已归一化的配置。
 * @returns `{ status, start, stop }`，全部返回普通 JSON 对象，调用方不处理异常分支。
 */
export function createServiceManager(ctx, config) {
  /** 正在进行的启动过程：并发的 start 复用同一次，避免两套 pg_ctl 打架。 */
  let pending
  /** 本插件拉起来的应用进程 pid（停止时优先按它收）。 */
  let spawnedPid

  /**
   * 应用是否健康。
   * @returns 是否 200。
   */
  async function healthy() {
    try {
      const response = await fetch(config.healthUrl, { signal: AbortSignal.timeout(2_500) })
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * PostgreSQL 是否接受连接。
   * @returns 是否就绪。
   */
  async function postgresReady() {
    try {
      await execFileAsync(join(config.pgBin, 'pg_isready.exe'), ['-h', 'localhost', '-p', '5432'], {
        timeout: 5_000,
        windowsHide: true,
      })
      return true
    } catch {
      return false
    }
  }

  /**
   * 解析真正的 node 可执行文件。
   *
   * **绝不能用 `process.execPath`**：Host 里它是 electron.exe，拿它去跑
   * `apps/server/dist/index.mjs` 只会再开一个 Electron 实例。
   * @returns 绝对路径或原始命令名。
   */
  async function nodeExecutable() {
    const subprocess = safeGet('subprocess')
    if (subprocess !== undefined && typeof subprocess.resolveExecutable === 'function') {
      try {
        const resolved = await subprocess.resolveExecutable(config.nodePath)
        if (!/electron(\.exe)?$/i.test(resolved)) return resolved
      } catch {
        /* 回落 */
      }
    }
    return config.nodePath
  }

  /**
   * 取一个可选服务。
   * @param name - 服务名。
   * @returns 服务实例或 undefined。
   */
  function safeGet(name) {
    try {
      return ctx.get?.(name)
    } catch {
      return undefined
    }
  }

  /**
   * 当前状态（不会启动任何东西）。
   * @returns `{ running, postgres, appUrl, pid, healthUrl }`。
   */
  async function status() {
    const [running, postgres] = await Promise.all([healthy(), postgresReady()])
    const embeddable = running ? !(await blocksFraming()) : true
    return {
      running,
      postgres,
      embeddable,
      appUrl: config.appUrl,
      healthUrl: config.healthUrl,
      pid: spawnedPid ?? null,
    }
  }

  /**
   * 运行中的应用是否仍然拒绝被 iframe 嵌入。
   *
   * 只看**当前响应头**：构建产物改过、但进程还是旧代码时这里仍是 true，
   * 于是 start() 会重启应用让补丁生效。
   * @returns 是否仍然发 X-Frame-Options。
   */
  async function blocksFraming() {
    try {
      const response = await fetch(`${config.appUrl}/`, { signal: AbortSignal.timeout(4_000), redirect: 'manual' })
      const value = response.headers.get('x-frame-options')
      return value !== null && value.trim() !== ''
    } catch {
      return false
    }
  }

  /**
   * 找出监听某个端口（LISTENING）的进程 id。
   *
   * 为什么不用 `Get-CimInstance Win32_Process | Where CommandLine -like ...`：
   * 那条 PowerShell 单行经 execFile 传参时会被引号层反复折腾（实测直接报错）。
   * `netstat -ano` 的输出是稳定的五列表，解析起来没有引号问题。
   * @param port - 端口号。
   * @returns 进程 id，或 undefined。
   */
  async function listenerPid(port) {
    try {
      const { stdout } = await execFileAsync('netstat.exe', ['-ano', '-p', 'TCP'], {
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024,
      })
      for (const line of String(stdout).split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/)
        if (parts.length < 5) continue
        const [, local, , state, pidText] = parts
        if (!/^LISTENING$/i.test(state)) continue
        if (!local.endsWith(`:${port}`)) continue
        const pid = Number(pidText)
        if (Number.isInteger(pid) && pid > 0) return pid
      }
    } catch {
      /* 拿不到就当没有 */
    }
    return undefined
  }

  /**
   * 停掉应用进程（不动数据库）。停止流程与"嵌入补丁生效后重启应用"共用。
   * @returns 步骤描述数组。
   */
  async function stopApp() {
    const steps = []
    if (typeof spawnedPid === 'number') {
      try {
        process.kill(spawnedPid)
        steps.push(`已终止应用进程 ${spawnedPid}`)
      } catch {
        steps.push(`应用进程 ${spawnedPid} 已不在`)
      }
      spawnedPid = undefined
    }

    const pid = await listenerPid(config.appPort)
    if (pid !== undefined) {
      try {
        await execFileAsync('taskkill.exe', ['/PID', String(pid), '/F', '/T'], { windowsHide: true, timeout: 15_000 })
        steps.push(`已终止占用 :${config.appPort} 的应用进程 ${pid}`)
      } catch (error) {
        steps.push(`终止进程 ${pid} 失败：${String(error?.message ?? error).slice(0, 160)}`)
      }
    }
    return steps
  }

  /**
   * 启动数据库与应用（幂等）。
   * @returns `{ ok, state, steps, detail? }`。
   */
  async function start() {
    if (pending !== undefined) return await pending

    pending = (async () => {
      const steps = []

      // 第一步：让应用允许被嵌入 + 发布并注入选区桥脚本（都幂等；构建更新后会自动补回来）。
      const patch = await ensureEmbeddable(config)
      const asset = await publishBridgeScript(config)
      const script = await ensureBridgeScript(config)
      steps.push(patch.note, asset.note, script.note)

      if (await healthy()) {
        if (!patch.changed && !script.changed && !asset.changed) return { ok: true, state: 'already-running', steps }
        // 补丁改的是构建产物：已在跑的进程还是旧代码，必须重启应用才能让新响应头/脚本生效。
        if (patch.changed) steps.push('构建已更新，重启应用以加载新的响应头')
        else steps.push('页面脚本已更新，重启应用以送达新的入口文档')
        steps.push(...(await stopApp()))
        if (!(await waitFor(async () => !(await healthy()), 20_000))) {
          return { ok: false, state: 'app-still-running', steps, detail: '应用进程没停下来，嵌入补丁尚未生效。' }
        }
        steps.push('应用已停止，准备按新构建重启')
      }

      if (!(await postgresReady())) {
        try {
          await execFileAsync(join(config.pgBin, 'pg_ctl.exe'), ['-D', config.pgData, '-l', config.pgLog, 'start'], {
            timeout: 30_000,
            windowsHide: true,
          })
          steps.push('pg_ctl start 已发出')
        } catch (error) {
          // pg_ctl 在 "另一个 server 已在运行" 时也会非零退出：不急着判死，交给 pg_isready 裁决
          steps.push(`pg_ctl start 返回非零（${String(error?.stderr ?? error?.message ?? error).trim().slice(0, 200)}）`)
        }
        if (!(await waitFor(postgresReady, PG_ISREADY_TIMEOUT_MS))) {
          return {
            ok: false,
            state: 'postgres-timeout',
            steps,
            detail: logTail(config.pgLog) || 'PostgreSQL 未在 40s 内就绪，且 pg.log 为空。',
          }
        }
        steps.push('PostgreSQL 就绪')
      } else {
        steps.push('PostgreSQL 已在运行')
      }

      const socket = openSync(config.serverLog, 'a')
      const executable = await nodeExecutable()
      const child = spawn(executable, [config.serverEntry], {
        detached: true,
        stdio: ['ignore', socket, socket],
        windowsHide: true,
        cwd: config.appDir,
        env: {
          ...process.env,
          NODE_ENV: 'production',
          PORT: String(config.appPort),
          DATABASE_URL: config.databaseUrl,
        },
      })
      child.unref()
      spawnedPid = child.pid ?? null
      steps.push(`应用进程已启动（pid ${spawnedPid ?? '未知'}，exe ${executable}）`)

      if (!(await waitFor(healthy, APP_TIMEOUT_MS))) {
        return {
          ok: false,
          state: 'app-timeout',
          steps,
          detail: logTail(config.serverLog) || '应用未在 60s 内健康，且 server.log 为空。',
        }
      }
      steps.push('应用就绪（/api/health 200）')
      return { ok: true, state: 'started', steps, pid: spawnedPid }
    })().finally(() => {
      pending = undefined
    })

    return await pending
  }

  /**
   * 停止应用与数据库。
   * @returns `{ ok, state, steps }`。
   */
  async function stop() {
    const steps = await stopApp()
    if (steps.length === 0) steps.push('没有应用进程在跑')

    // 数据库
    try {
      await execFileAsync(join(config.pgBin, 'pg_ctl.exe'), ['-D', config.pgData, 'stop', '-m', 'fast'], {
        timeout: 30_000,
        windowsHide: true,
      })
      steps.push('PostgreSQL 已停止')
    } catch (error) {
      steps.push(`pg_ctl stop 失败：${String(error?.stderr ?? error?.message ?? error).trim().slice(0, 200)}`)
    }

    const running = await healthy()
    return { ok: !running, state: running ? 'still-running' : 'stopped', steps }
  }

  return { status, start, stop }
}
