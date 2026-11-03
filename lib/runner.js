/**
 * 脚本执行器：所有工具最终都落到 `node 03-脚本\rr-cv.mjs <子命令> …`。
 *
 * 为什么不把 MCP 的 JSON-RPC 在插件里重写一遍：
 * rr-cv.mjs 已经把「解析返回 / 中文参数编码 / 写 _索引.md / 只检查不启动服务」这些
 * 易错环节做完了，重写等于再造一个会漂移的副本。插件只负责把它包成工具。
 *
 * 为什么优先用 `ctx.subprocess`：
 * 它是宿主里**唯一**受管理的进程缝（可取消、可终止、输出不互相吞）。服务不在时
 * 退回 `node:child_process`，保证插件在裁剪过的组合里也能用。
 *
 * @module dsh-resume-assistant/lib/runner
 */
import { execFile } from 'node:child_process'

const MAX_STDOUT_BYTES = 1 << 20
const MAX_STDERR_BYTES = 1 << 18
const GRACE_MS = 4_000

/**
 * 取可选的 subprocess 服务。
 * @param ctx - 插件上下文。
 * @returns 服务实例或 undefined（组合里没挂时）。
 */
function subprocessService(ctx) {
  try {
    return ctx.get?.('subprocess')
  } catch {
    return undefined
  }
}

/**
 * 合并调用方的取消信号与自身的超时。
 * @param signal - 工具调用信号。
 * @param timeoutMs - 超时毫秒。
 * @returns 可传给 spawn 的信号。
 */
function deadline(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) return timeout
  return typeof AbortSignal.any === 'function' ? AbortSignal.any([signal, timeout]) : signal
}

/**
 * 读一个收集式输出读取器。
 * @param reader - `SubprocessOutputReader`。
 * @returns 文本、是否截断、以及完整输出落盘路径。
 */
function readCollected(reader) {
  if (reader === undefined) return { text: '', lossy: false }
  try {
    const read = reader.readFrom(0)
    return { text: read?.text ?? '', lossy: read?.lossy === true, spillPath: read?.spillPath }
  } catch {
    return { text: '', lossy: false }
  }
}

/**
 * 退出码归一化：`execFile` 会把超时/信号也塞进 error.code（字符串）。
 * @param error - 回调错误。
 * @returns 数字退出码。
 */
function exitCodeOf(error) {
  if (error === null || error === undefined) return 0
  return typeof error.code === 'number' ? error.code : 1
}

/**
 * 创建执行器。
 * @param ctx - 插件上下文（用来取可选服务）。
 * @param config - 已归一化的配置。
 * @returns `{ run, describe }`。
 */
export function createRunner(ctx, config) {
  /** 解析一次就缓存：解析失败也缓存，避免每次调用都白跑一遍 PATH。 */
  let cachedProgram

  /**
   * 解析 node 可执行文件。
   * @param signal - 取消信号。
   * @returns 绝对路径或原始命令名。
   */
  async function program(signal) {
    if (cachedProgram !== undefined) return cachedProgram
    const service = subprocessService(ctx)
    if (service !== undefined && typeof service.resolveExecutable === 'function') {
      try {
        cachedProgram = await service.resolveExecutable(config.nodePath, undefined, signal)
        return cachedProgram
      } catch {
        // 解析不出来就用原始名字，交给 spawn 自己报错
      }
    }
    cachedProgram = config.nodePath
    return cachedProgram
  }

  /**
   * 直接 spawn（无受管理服务时的退路）。
   * @param argv - 完整 argv。
   * @param signal - 取消信号。
   * @returns 执行结果。
   */
  async function runDirect(argv, signal) {
    const [executable, ...args] = argv
    return await new Promise((resolve) => {
      const child = execFile(
        executable,
        args,
        {
          cwd: config.scriptDir,
          timeout: config.timeoutMs,
          maxBuffer: 8 * 1024 * 1024,
          encoding: 'utf8',
          windowsHide: true,
        },
        (error, stdout, stderr) => {
          resolve({
            exitCode: exitCodeOf(error),
            stdout: typeof stdout === 'string' ? stdout : '',
            stderr: typeof stderr === 'string' ? stderr : '',
            lossy: false,
          })
        },
      )
      signal?.addEventListener?.(
        'abort',
        () => {
          try {
            child.kill()
          } catch {
            /* 已经退出 */
          }
        },
        { once: true },
      )
    })
  }

  /**
   * 跑一条 rr-cv.mjs 子命令。
   * @param args - 子命令及其参数（不传 node / 脚本路径）。
   * @param [exec] - 工具执行上下文（用其 signal 支持取消）。
   * @returns `{ exitCode, stdout, stderr, lossy, spillPath }`；不因非零退出而抛错。
   */
  async function spawnScript(args, exec) {
    const signal = deadline(exec?.signal, config.timeoutMs)
    const executable = await program(signal)
    const argv = [executable, config.scriptPath, ...args]

    const service = subprocessService(ctx)
    if (service !== undefined && typeof service.spawn === 'function') {
      let handle
      try {
        handle = service.spawn({
          argv,
          cwd: config.scriptDir,
          stdio: {
            stdin: 'ignore',
            stdout: { maxBytes: MAX_STDOUT_BYTES },
            stderr: { maxBytes: MAX_STDERR_BYTES },
          },
          graceMs: GRACE_MS,
          signal,
        })
      } catch {
        handle = undefined
      }
      if (handle !== undefined) {
        try {
          const outcome = await handle.done
          const stdout = readCollected(handle.collected?.stdout)
          const stderr = readCollected(handle.collected?.stderr)
          return {
            exitCode: typeof outcome?.exitCode === 'number' ? outcome.exitCode : 1,
            stdout: stdout.text,
            stderr: stderr.text,
            lossy: stdout.lossy || stderr.lossy,
            spillPath: stdout.spillPath ?? stderr.spillPath,
          }
        } catch (error) {
          return {
            exitCode: 1,
            stdout: '',
            stderr: `进程启动或运行失败：${error instanceof Error ? error.message : String(error)}`,
            lossy: false,
          }
        }
      }
    }

    return await runDirect(argv, signal)
  }

  /**
   * 跑一条子命令并把输出整理成一段给人/模型看的文本。
   *
   * 非零退出**不抛错**：`rr-cv.mjs doctor` 发现问题时故意 `exitCode = 1`，
   * 那种情况下的 stdout 才是答案本身，抛错会把它吞掉。
   * @param args - 子命令及参数。
   * @param [exec] - 工具执行上下文。
   * @returns `{ text, exitCode }`。
   */
  async function run(args, exec) {
    const result = await spawnScript(args, exec)
    const chunks = []
    if (result.stdout.trim() !== '') chunks.push(result.stdout.trim())
    if (result.stderr.trim() !== '') chunks.push(result.stderr.trim())
    let text = chunks.length > 0 ? chunks.join('\n') : `(命令无输出，退出码 ${result.exitCode})`
    if (result.exitCode !== 0) text += `\n\n[exit code: ${result.exitCode}]`
    if (result.lossy) text += `\n\n[输出被截断${result.spillPath ? `，完整内容见 ${result.spillPath}` : ''}]`
    return { text, exitCode: result.exitCode }
  }

  return { run, spawnScript }
}
