/**
 * 照片内联：把 `picture.url` 换成 data URL。
 *
 * 为什么必须内联：头像存在应用自己的 `/api/uploads/...` 上，那个路由**要登录**。
 * 预览 iframe 和 PDF 打印都没有登录态，直接引用只会得到一张裂图。
 * 所以渲染前在宿主里把图片抓下来、转成 base64 塞进文档 —— 预览和 PDF 都自包含。
 *
 * @module dsh-resume-assistant/lib/photo
 */

/** 单张照片的大小上限（超过就放弃内联，回落到原 URL）。 */
const MAX_BYTES = 2_500_000

/**
 * 把一份简历文档里的照片内联。
 * @param doc - `resume.data`。
 * @param appUrl - 应用地址（用于把相对路径补全）。
 * @returns 新的文档对象（不改原对象）。
 */
export async function inlinePhoto(doc, appUrl) {
  const picture = doc?.picture
  const url = typeof picture?.url === 'string' ? picture.url : ''
  if (url === '' || url.startsWith('data:')) return doc

  const absolute = url.startsWith('http') ? url : `${appUrl}${url.startsWith('/') ? '' : '/'}${url}`
  try {
    const response = await fetch(absolute, { signal: AbortSignal.timeout(6_000) })
    if (!response.ok) return doc
    const type = response.headers.get('content-type') ?? 'image/jpeg'
    if (!type.startsWith('image/')) return doc
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length === 0 || buffer.length > MAX_BYTES) return doc
    return { ...doc, picture: { ...picture, url: `data:${type};base64,${buffer.toString('base64')}` } }
  } catch {
    return doc
  }
}
