/**
 * 资源发布：把插件自带的静态文件送到**应用的源**上。
 *
 * 为什么不能挂在 DSH 上：注入到应用 `index.html` 的那行 `<script src="/dsh-resume-bridge.js">`
 * 是按**应用**的地址解析的（`http://localhost:3000/...`），而且应用的 CSP 是
 * `script-src 'self'` —— 跨源外链会被拦。所以文件必须由应用自己发出来。
 *
 * 应用是 `.next`/vite 风格的产物：它会把 `dist` 下的静态资源按名字托管。把文件写进
 * `apps/web/dist/` 之后，`/dsh-resume-bridge.js` 就能被直接取到（实测 200）。
 * 这条路径每次 start 都会重写一次（幂等、几 KB），应用重建后也会自动补回。
 *
 * @module dsh-resume-assistant/lib/assets
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** 注入给应用的脚本名（也就是它的 URL 路径）。 */
export const BRIDGE_SCRIPT_NAME = 'dsh-resume-bridge.js'

/** 插件里的源文件。 */
const SOURCE_URL = new URL('../assets/bridge-script.js', import.meta.url)

/**
 * 读出插件自带的桥脚本。
 * @returns 脚本文本；读不到给空串。
 */
export async function readBridgeSource() {
  try {
    return await readFile(SOURCE_URL, 'utf8')
  } catch {
    return ''
  }
}

/**
 * 把桥脚本发布到应用的静态目录。
 * @param config - 已归一化的配置。
 * @returns `{ changed, note, path }`。
 */
export async function publishBridgeScript(config) {
  const source = await readBridgeSource()
  if (source === '') return { changed: false, note: '插件内缺少 assets/bridge-script.js' }

  const target = join(config.appDir, 'apps', 'web', 'dist', BRIDGE_SCRIPT_NAME)
  try {
    const existing = await readFile(target, 'utf8')
    if (existing === source) return { changed: false, note: '选区桥脚本已就位', path: target }
  } catch {
    /* 需要写入 */
  }

  try {
    await writeFile(target, source, 'utf8')
  } catch (error) {
    return {
      changed: false,
      note: `写入选区桥脚本失败：${error instanceof Error ? error.message : String(error)}`,
      path: target,
    }
  }
  return { changed: true, note: `已发布选区桥脚本 → ${BRIDGE_SCRIPT_NAME}`, path: target }
}
