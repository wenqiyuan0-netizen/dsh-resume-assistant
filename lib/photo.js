/**
 * 照片内联：把 `picture.url` 换成 data URL。
 *
 * 为什么必须内联：打印用的无头浏览器打开的是一个本地 HTML 文件，`file://` 下的
 * 页面去请求 `http://localhost:3000/api/uploads/...` 会跨源、也会在没有登录态时
 * 失败——纸面上那张脸就没了。所以渲染前在宿主里把图片抓下来、转成 base64 塞进
 * 文档，预览与 PDF 都自包含。
 *
 * 抓取顺序：
 * 1. 已经是 data URL → 原样放行；
 * 2. HTTP 抓（应用的 uploads 路由是公开的，实测 200）；
 * 3. **磁盘兜底**：应用的存储就在 `<appDir>/data/uploads` 下，按文件名递归找一份。
 *    服务没起、端口被占、或者将来上了鉴权，这条路都能把照片捞回来。
 *
 * @module dsh-resume-assistant/lib/photo
 */
import { readdir, readFile } from 'node:fs/promises'
import { extname, join } from 'node:path'

/** 单张照片的大小上限（超过就放弃内联，回落到原 URL）。 */
const MAX_BYTES = 2_500_000

/** 按扩展名给个 MIME；磁盘兜底时没有响应头可用。 */
function mimeOf(file) {
  const ext = extname(file).toLowerCase()
  if (ext === '.png') return 'image/png'
  if (ext === '.webp') return 'image/webp'
  if (ext === '.gif') return 'image/gif'
  return 'image/jpeg'
}

/**
 * 在应用的数据目录里按文件名找一份上传的图片。
 * @param uploadsDir - `<appDir>/data/uploads`。
 * @param fileName - 目标文件名（如 `1794251854315.jpeg`）。
 * @param depth - 还剩几层可以往下翻。
 * @returns 绝对路径或 null。
 */
async function findOnDisk(uploadsDir, fileName, depth = 3) {
  if (fileName === '' || depth < 0) return null
  let entries
  try {
    entries = await readdir(uploadsDir, { withFileTypes: true })
  } catch {
    return null
  }
  for (const entry of entries) {
    const full = join(uploadsDir, entry.name)
    if (entry.isFile() && entry.name === fileName) return full
    if (entry.isDirectory()) {
      const nested = await findOnDisk(full, fileName, depth - 1)
      if (nested !== null) return nested
    }
  }
  return null
}

/**
 * 把一份简历文档里的照片内联。
 * @param doc - `resume.data`。
 * @param appUrl - 应用地址（用于把相对路径补全）。
 * @param options - `{ appDir }`：应用目录，给磁盘兜底用。
 * @returns 新的文档对象（不改原对象）。
 */
export async function inlinePhoto(doc, appUrl, options = {}) {
  const picture = doc?.picture
  const url = typeof picture?.url === 'string' ? picture.url.trim() : ''
  if (url === '' || url.startsWith('data:')) return doc

  const absolute = url.startsWith('http') ? url : `${appUrl}${url.startsWith('/') ? '' : '/'}${url}`

  // 1. HTTP
  try {
    const response = await fetch(absolute, { signal: AbortSignal.timeout(6_000) })
    if (response.ok) {
      const type = response.headers.get('content-type') ?? 'image/jpeg'
      if (type.startsWith('image/')) {
        const buffer = Buffer.from(await response.arrayBuffer())
        if (buffer.length > 0 && buffer.length <= MAX_BYTES) {
          return { ...doc, picture: { ...picture, url: `data:${type};base64,${buffer.toString('base64')}` } }
        }
      }
    }
  } catch {
    /* 落到磁盘兜底 */
  }

  // 2. 磁盘兜底：URL 的最后一段就是文件名。
  const appDir = typeof options.appDir === 'string' && options.appDir !== '' ? options.appDir : ''
  if (appDir !== '') {
    const segments = absolute.split(/[?#]/)[0].split('/').filter(Boolean)
    const fileName = segments.at(-1) ?? ''
    const found = await findOnDisk(join(appDir, 'data', 'uploads'), fileName)
    if (found !== null) {
      try {
        const buffer = await readFile(found)
        if (buffer.length > 0 && buffer.length <= MAX_BYTES) {
          return {
            ...doc,
            picture: { ...picture, url: `data:${mimeOf(found)};base64,${buffer.toString('base64')}` },
          }
        }
      } catch {
        /* 读不出来就放弃内联 */
      }
    }
  }

  return doc
}
