/**
 * 让应用能被嵌进 DSH 的 Web 页面，并让页面能把"选中了哪块"报给 DSH。
 *
 * 两处改动，都只动构建产物、都可逆、都幂等：
 *
 * 1. **去掉根文档的 `X-Frame-Options: DENY`** —— 否则 iframe 只能白屏。
 *    为什么不做反代：应用文档里的 `/assets/*` 是绝对路径，代理到 DSH 源上会
 *    与 DSH 自己的 `/api` 撞车，还会丢掉应用自己的登录 cookie。
 *
 * 2. **往 web 的 `index.html` 注入一段小脚本**（assets/bridge-script.js）——
 *    它在应用的世界里读 DOM，把点击到的栏目/条目翻译成简历语言里的地址
 *    （`/basics/name`、`/sections/experience/items/2`）postMessage 给 DSH，
 *    这在跨域 iframe 下是唯一可行的通路（父页面读不到子文档的 DOM）。
 *
 * 备份：改动前把原文件复制成 `<文件名>.dsh-orig`；应用重建把这行/这段带回来时，
 * 下次 start 会再补一次。
 *
 * @module dsh-resume-assistant/lib/patch-app
 */
import { readFileSync } from 'node:fs'
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
/** 要去掉的那一条（对象形式，位于 BASE_SECURITY_HEADERS）。 */
const NEEDLE = '"X-Frame-Options": "DENY",'

/** 备份后缀。 */
const BACKUP_SUFFIX = '.dsh-orig'

/** 注入到 index.html 的脚本标记（幂等判据）。 */
export const SCRIPT_MARKER = 'data-dsh-resume-bridge'

/** 我们自己的脚本源。 */
const SCRIPT_FILE_URL = new URL('../assets/bridge-script.js', import.meta.url)

/**
 * 应用服务构建入口路径。
 * @param config - 已归一化的配置。
 * @returns 绝对路径。
 */
export function serverBundlePath(config) {
  return join(config.appDir, 'apps', 'server', 'dist', 'index.mjs')
}

/**
 * 应用 web 文档（被服务器当作前端入口的那份）。
 * @param config - 已归一化的配置。
 * @returns 绝对路径。
 */
export function webIndexPath(config) {
  return join(config.appDir, 'apps', 'web', 'dist', 'index.html')
}

/**
 * 备份一次（已存在就不覆盖，保留最原始的那份）。
 * @param file - 目标文件。
 * @returns 备份路径，或 undefined（备份失败）。
 */
async function backupOnce(file) {
  const backupPath = `${file}${BACKUP_SUFFIX}`
  try {
    await stat(backupPath)
    return backupPath
  } catch {
    try {
      await copyFile(file, backupPath)
      return backupPath
    } catch {
      return undefined
    }
  }
}

/**
 * 确保应用允许被嵌入（幂等）。
 * @param config - 已归一化的配置。
 * @returns `{ changed, note, backupPath? }`；不抛错，失败只报告。
 */
export async function ensureEmbeddable(config) {
  const file = serverBundlePath(config)

  let info
  try {
    info = await stat(file)
  } catch {
    return { changed: false, note: `找不到应用构建入口：${file}` }
  }
  if (!info.isFile()) return { changed: false, note: `应用构建入口不是文件：${file}` }

  let text
  try {
    text = await readFile(file, 'utf8')
  } catch (error) {
    return { changed: false, note: `读不了应用构建入口：${error instanceof Error ? error.message : String(error)}` }
  }

  if (!text.includes(NEEDLE)) {
    return { changed: false, note: '应用已允许被嵌入（或构建里没有该响应头），无需改动' }
  }

  const backupPath = await backupOnce(file)
  if (backupPath === undefined) return { changed: false, note: '备份失败，未改动' }

  try {
    await writeFile(file, text.replace(NEEDLE, ''), 'utf8')
  } catch (error) {
    return { changed: false, note: `写入失败：${error instanceof Error ? error.message : String(error)}` }
  }

  return {
    changed: true,
    note: '已去掉根文档的 X-Frame-Options: DENY（原文件备份为 index.mjs.dsh-orig）',
    backupPath,
  }
}

/**
 * 确保 web 入口注入了桥脚本（幂等）。
 *
 * 注入用**外部脚本**而不是内联：应用的 CSP 里有 `script-src 'self'`，
 * 外链自己源上的文件不受影响，内联则有被拦的风险。
 * @param config - 已归一化的配置。
 * @returns `{ changed, note }`。
 */
export async function ensureBridgeScript(config) {
  const file = webIndexPath(config)

  let text
  try {
    text = await readFile(file, 'utf8')
  } catch {
    return { changed: false, note: `找不到 web 入口：${file}` }
  }
  if (text.includes(SCRIPT_MARKER)) return { changed: false, note: '桥脚本已在页面里' }

  const tag = `<script ${SCRIPT_MARKER} src="/dsh-resume-bridge.js"></script>`
  const next = text.includes('</body>') ? text.replace('</body>', `${tag}\n</body>`) : `${text}\n${tag}\n`

  const backupPath = await backupOnce(file)
  if (backupPath === undefined) return { changed: false, note: '备份失败，未注入桥脚本' }

  try {
    await writeFile(file, next, 'utf8')
  } catch (error) {
    return { changed: false, note: `注入失败：${error instanceof Error ? error.message : String(error)}` }
  }
  return { changed: true, note: '已往应用页面注入选区桥脚本（原文件备份为 index.html.dsh-orig）' }
}

/**
 * 读出桥脚本正文（给宿主路由兜底用的场合）。
 * @returns 脚本文本；读不到给空串。
 */
export function readBridgeScript() {
  try {
    return readFileSync(fileURLToPath(SCRIPT_FILE_URL), 'utf8')
  } catch {
    return ''
  }
}

/**
 * 还原到备份（应用重建出问题时用）。
 * @param config - 已归一化的配置。
 * @returns `{ restored, note }`。
 */
export async function restoreAppBundle(config) {
  const results = []
  for (const file of [serverBundlePath(config), webIndexPath(config)]) {
    try {
      await copyFile(`${file}${BACKUP_SUFFIX}`, file)
      results.push(`已还原 ${file}`)
    } catch {
      results.push(`没有可用的备份：${file}${BACKUP_SUFFIX}`)
    }
  }
  return { restored: true, note: results.join('\n') }
}
