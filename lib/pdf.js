/**
 * HTML → PDF。
 *
 * 这台机器上没有 LibreOffice（已验证），所以用**宿主自带的 Chromium**：
 * Electron 主进程可以创建隐藏窗口、`printToPDF`，这是零依赖、和预览同一套排版的做法。
 *
 * 拿不到 Electron（例如插件被跑在纯 Node 里）时不算失败：返回
 * `{ needsPrint: true, html }`，客户端开一个打印窗口让用户"另存为 PDF"，
 * 排版完全一致。
 *
 * @module dsh-resume-assistant/lib/pdf
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 把 HTML 打印成 PDF 文件。
 * @param html - 完整 HTML 文本。
 * @param targetPath - 目标 .pdf 绝对路径。
 * @returns `{ ok, path }` 或 `{ needsPrint: true, html, reason }`。
 */
export async function htmlToPdf(html, targetPath) {
  let BrowserWindow
  try {
    const electron = await import('electron')
    BrowserWindow = electron?.BrowserWindow ?? electron?.default?.BrowserWindow
  } catch (error) {
    return { needsPrint: true, html, reason: `没有 Electron：${error instanceof Error ? error.message : String(error)}` }
  }
  if (typeof BrowserWindow !== 'function') {
    return { needsPrint: true, html, reason: '当前进程没有 BrowserWindow' }
  }

  let window
  try {
    window = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: { offscreen: true, javascript: false, sandbox: true },
    })
    const dataUrl = `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf8').toString('base64')}`
    await window.loadURL(dataUrl)
    const pdf = await window.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    })
    await mkdir(dirname(targetPath), { recursive: true })
    await writeFile(targetPath, pdf)
    return { ok: true, path: targetPath, bytes: pdf.length }
  } catch (error) {
    return {
      needsPrint: true,
      html,
      reason: `打印失败：${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    try {
      window?.destroy()
    } catch {
      /* 已经销毁 */
    }
  }
}
