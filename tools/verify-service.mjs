/**
 * 服务管理器的真机验证：不经过 DSH 宿主，直接跑 lib/service.js 的同一份代码。
 *
 * 用法：
 *   node tools/verify-service.mjs status
 *   node tools/verify-service.mjs start
 *   node tools/verify-service.mjs stop
 *   node tools/verify-service.mjs roundtrip     # start → status → 报告（不 stop）
 *
 * 它验证的正是「agent 能不能自己把服务拉起来」：进程从这里 spawn、detached + unref，
 * 脚本退出后它们必须继续活着（下一次 status 能看到 running=true）。
 */
import { normalizeConfig } from '../lib/config.js'
import { createServiceManager } from '../lib/service.js'

const action = process.argv[2] ?? 'status'
const config = normalizeConfig({})

/** 宿主里没有 subprocess 服务时的等价桩：只提供 resolveExecutable。 */
const ctx = {
  get(name) {
    if (name !== 'subprocess') return undefined
    return {
      async resolveExecutable(command) {
        const { execFile } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const run = promisify(execFile)
        if (/[\\/]/.test(command)) return command
        const { stdout } = await run('where.exe', [command], { windowsHide: true })
        return String(stdout).split(/\r?\n/).filter(Boolean)[0] ?? command
      },
    }
  },
  logger: { info: console.log, warn: console.warn },
}

const service = createServiceManager(ctx, config)

/** 打印结果。 */
function report(label, value) {
  console.log(`\n== ${label} ==`)
  console.log(JSON.stringify(value, null, 2))
}

if (action === 'status') {
  report('status', await service.status())
} else if (action === 'start') {
  report('start', await service.start())
} else if (action === 'stop') {
  report('stop', await service.stop())
} else if (action === 'roundtrip') {
  report('start', await service.start())
  report('status', await service.status())
  console.log('\n进程应已脱离本脚本：稍后再跑 `node tools/verify-service.mjs status` 仍应为 running=true。')
} else {
  console.error(`未知动作：${action}`)
  process.exitCode = 1
}
