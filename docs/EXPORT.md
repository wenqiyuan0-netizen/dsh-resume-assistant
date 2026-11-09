# 导出 PDF —— 一条实现，两个面板

> 这份文件是**契约**：宿主侧的路由长什么样，两个面板的导出窗口就得照着它说话。
> 改路由就改这里，别让面板去猜。

## 为什么要重建

旧实现的三处硬伤（都能在日志里复现）：

| 症状 | 原因 |
|---|---|
| 点「导出 PDF」只弹一句"这台机器没有 Electron 打印器" | `lib/pdf.js` 在插件进程里 `new BrowserWindow`，拿不到（不是 Electron 主进程）；一失败就 return，PDF 从未生成 |
| 导出的 PDF 里没有照片 | 克隆出来的简历 `picture.url` 是 `http://localhost:3000/api/uploads/...`；打印页 `file://` 跨源取不到图 |
| 没有截图、没有索引、没有"文件在哪" | 截图只写在 Electron 分支里；索引只有工具那条路写；打开文件夹从来没人做 |

## 宿主路由

前缀 `/api/resume-bridge`（客户端用绝对路径，页面挂在子路径下也不会 404）。

### `POST local/plan`

算目标路径和"会不会盖掉谁"，**导出前**用它把话说清楚。

```jsonc
// 请求
{ "id": "<简历 id>", "doc": { /* 可选：面板的实时草稿 */ },
  "folder": "Wenqi Yuan – Gastronomie", "filename": "Wenqi Yuan – Gastronomie-CV" }
// 响应
{ "folder": "Wenqi Yuan – Gastronomie",
  "file": "Wenqi Yuan – Gastronomie-CV.pdf",
  "path": "C:\\...\\04-输出\\Wenqi Yuan – Gastronomie\\...-CV.pdf",
  "exists": true, "bytes": 34990, "mtime": "2026-11-09T19:13:35.000Z" }
```

### `POST local/export`

```jsonc
// 请求
{ "id": "<简历 id>"          // 二者给一个；doc 优先（面板里没保存的改动也要印出来）
  "doc": { /* 实时草稿 */ },
  "folder": "…", "filename": "…",       // 可省，默认用简历名 / <目录>-CV
  "overwrite": "overwrite" | "version", // 默认覆盖；version = 落成 名字 (2).pdf
  "screenshots": true,                  // 默认 true
  "reveal": true }                      // 默认 false；true = 导完在资源管理器里选中
```

成功：

```jsonc
{ "ok": true, "id": "...", "name": "...",
  "path": "…\\foo.pdf", "dir": "…", "folder": "…", "file": "foo.pdf",
  "bytes": 122952, "pages": 1, "sheets": 1, "overflow": false,
  "screenshots": ["…\\foo.png"], "screenshot": "…\\foo.png",
  "renderer": "chromium:chrome.exe", "ms": 2924,
  "overwrote": true, "previous": { "bytes": 34990, "mtime": "…" },
  "index": "已加入索引", "revealed": true }
```

失败：`{ "ok": false, "reason": "…", "needsPrint"?: true, "html"?: "…", "target": "…" }`
（`needsPrint` 只有在整台机器上既没有 Chromium 也没有 Electron 时才会出现。）

- `pages` = PDF 页数，`sheets` = 渲染出来的 A4 纸张数。`overflow: true` = 有内容溢出到下一页，
  **必须**在窗口里红字提示（缩内容或调小字号），别当成功。
- 截图按纸来：第 1 页与 PDF 同名 `.png`，之后 `-p2.png`、`-p3.png`。

### `POST local/reveal` / `POST local/open`

`{ "path": "…\\foo.pdf" }` → `{ ok, method, detail, path }`。前者在资源管理器里**选中**，
后者用默认程序**打开**。**别只看 `ok` 就完事**：这三样合起来才说明白"到底做成了什么"。

- `method`：`powershell | explorer.exe | electron | viewer | shell | open | xdg-open`。
- `detail`：人话，例如 `shell:explorer /select（窗口已出现）`、
  `系统没打开，改用 msedge.exe（.pdf 关联是坏的，退到浏览器）`。
- 失败也是 **HTTP 200 + `ok:false`**，`detail` 写原因。客户端必须把它显示出来——
  静默是上一轮"按钮全部无效"的根因。

> 为什么这么绕：这台机器上 `.pdf` 的关联指向 `MSEdgePDF`，可 `Start-Process <pdf>` 与
> `explorer <pdf>` 都不启动任何东西（`.txt` 正常）。所以 `open` 必须去**看窗口有没有出现**，
> 没出现就退到本机浏览器；`reveal` 也必须是 `Start-Process explorer ... /select,"<path>"`
> 再回查窗口，而不是"进程起来了就算成功"。

### `POST local/render`

`{ "doc": {…} }`（面板草稿）或 `{ "id": "…" }`（存好的某一份）→ 一份完整 HTML。
导出窗口里的缩略图就用它：`iframe srcDoc=… scale(.42)`，和导出**同一份排版**。

### `GET local/file?path=<绝对路径>`

只放行 `04-输出` 里的 `png/jpg/jpeg/webp/pdf`，用来给窗口里的缩略图当 `<img src>`。

## 窗口该长什么样

两个面板用同一个结构，只是入口位置不同：

```
标题  导出 PDF · <简历名>                                    [×]
────
简历    [ 下拉：8 份简历 ]        模板 onyx · 照片 ✓ / 无照片 ⚠
目录    [ 输入 + 已有目录下拉 ]
文件名  [ 输入 ] .pdf
目标    04-输出\…\….pdf                                   （等宽小字）
状态    ● 将覆盖已有文件（34.9 KB · 11-09 20:13）    /  ● 新文件
        ☑ 覆盖同名文件    ☑ 导出后打开文件夹    ☑ 逐页截图核排版
预览    [ 第一页缩略图（iframe srcDoc，scale 0.42）→ 点开大图 ]
────
                          [取消]  [导出 PDF]   （导出中：转圈 + 导出中…）
```

导出完成后**不关窗**，原地换成结果卡：

```
✓ 已导出 · 1 页 · 120 KB · 2.9 s
路径   C:\…\04-输出\…\foo.pdf                     [打开文件夹] [打开 PDF] [再导一次]
截图   [缩略图]（多页时平铺，点开看大图）
⚠ 内容溢出到第 2 页（串页了）：缩内容或调小字号（仅 overflow 时出现）
```

## 客户端硬规矩

1. **打开窗口先 `local/plan`**（folder/filename/doc 变了 300 ms 防抖再问一次）——
   路径与覆盖提示永远来自宿主，不在前端拼字符串。
2. **面板里有草稿就发草稿**：`doc` 优先于 `id`。用户在面板里改了没保存，导出必须带上。
3. `overwrite` 跟勾选框走；`reveal` 跟勾选框走；`screenshots` 默认开。
4. `local/plan` 返回 404 或非 JSON（宿主还是旧版本）→ 窗口顶部一条黄色提示
   **「导出宿主是旧版本，重启 DSH 后生效」**，别的按钮照常可点。
5. 结果里的 `path` 原样显示，不要改写成相对路径；复制路径用 `navigator.clipboard`，失败静默。
6. 缩略图用 `local/file?path=`，`encodeURIComponent` 一遍。
