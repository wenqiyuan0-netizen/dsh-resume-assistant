/**
 * 兼容层：打印实现已经搬到 `lib/print.js`。
 *
 * 旧版本在这里直接 new `BrowserWindow` —— 但插件进程里拿不到它，于是每次导出都
 * 以 `当前进程没有 BrowserWindow` 收场（面板只弹一句"没有 Electron 打印器"，
 * 既没 PDF 也没截图）。现在真正的实现是「本机 Chromium 无头打印 + 逐页截图」，
 * 见 `print.js`；这个文件只为让 `bridge.js` / `tools.js` 的旧 import 继续有效。
 *
 * @module dsh-resume-assistant/lib/pdf
 */
export { htmlToPdf, countPdfPages, findChromium } from './print.js'
