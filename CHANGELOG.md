# Changelog

All notable changes to this plugin. Versions follow the DSH plugin compatibility range in `package.json`.

## Unreleased — 导出窗口的「打开文件夹 / 复制」点了没反应

报告的原话：*"打开文件夹和复制之类的功能按钮点击全部无效"*。两条独立原因，都是**沉默的失败**：

| 症状 | 真正发生的事 |
|---|---|
| 打开文件夹 | 宿主 `revealPath` 直接 `spawn('explorer.exe', ['/select,<path>'])`，**只要进程起来了就返回 true**。实测：返回 `true`，屏幕上一个窗口都没有（导出 3 次、窗口数始终 1）。客户端又只看 Promise 有没有 reject（宿主失败也是 200），于是按钮既不动作也不说话 |
| 打开 PDF | 这台机器的 `.pdf` 关联指向 `MSEdgePDF`，但 `Start-Process <pdf>` 与 `explorer <pdf>` **都不启动任何东西**（`.txt` 能正常开 Notepad），所以"用默认程序打开"在这台机器上从来就是空转 |
| 复制 | `navigator.clipboard.writeText` 没有 `.catch`、没有兜底、没有反馈：被拒时是一次 unhandled rejection，按钮毫无变化 |

改动：

- `lib/reveal.js` 重写：`revealPath` / `openPath` 返回 `{ ok, method, detail }`，并且**验证效果**——
  Windows 上用 `powershell Start-Process explorer.exe -ArgumentList '/select,"<path>"'`（ShellExecute，
  Unicode 与空格都稳），随后**比较打开前后的窗口标题**确认真的出现了；`openPath` 同理，系统默认程序
  没开起来就退到本机 Edge/Chrome（`.pdf` 关联坏了也照样能看到）。
- `lib/bridge.js`：`local/reveal`、`local/open` 原样回传 `method/detail`；`runExport` 带上 `reveal` 结果，
  `resume_export` 工具会说"（powershell）"或"资源管理器没打开：<原因>"。
- 两个面板：`打开文件夹 / 打开 PDF` 现在看 `ok` 说话（完成写 `detail`，失败写原因）；
  复制走 `navigator.clipboard` → `execCommand` 兜底，按钮就地变「已复制」/「复制失败」。

自检：`node tools/verify-export.mjs`（reveal 断言改为检查 `ok/method/detail`）、
一次性冒烟 `%TEMP%\jh-buttons-smoke.mjs`（reveal/open 的 200+ok:false 要走失败分支；剪贴板被拒要退
`execCommand` 且按钮文字变「已复制」；两条路都失败要写「复制失败」）。

## Unreleased — 导出 PDF 重建：真的出纸、真的带照片、真的告诉你文件在哪

报告的原话：*"彻底重修岗位猎手的简历功能的导出，现在做得一坨屎！导出在哪里呢，窗口呢，新内容覆盖呢，
自动进入文件夹呢，照片和渲染呢？"*

根因是打印器：`lib/pdf.js` 在插件进程里 `new BrowserWindow`，那个进程里根本没有它，于是每次导出都以
`当前进程没有 BrowserWindow` 结束 —— 面板只弹一句"这台机器没有 Electron 打印器"，PDF 从未生成，
截图自然也从未生成（`04-输出` 里 11-09 那几份 PDF 是别的老路径留下的，`/Subtype /Image` 计数为 0，
照片确实不在纸面上）。

| 层 | 改了什么 |
|---|---|
| 打印（新 `lib/print.js`） | 先找本机 **Chrome / Edge / Chromium / Brave**，用 `--headless=new` 打印；找不到才退 Electron，再退"交给人打印"。逐页 `--screenshot` 出 PNG（伪装成只剩第 K 张纸），A4 96 dpi ×2 缩放。实测一份 A4 带照片 PDF ≈ 3 s |
| 导出作业（新 `lib/export-job.js`） | 一条实现，桥和工具共用：取文档 → 内联照片 → 渲染 → 规划路径/覆盖策略 → 打印 → 逐页截图 → 写索引 → 可选选中文件。返回值带 `pages / sheets / overflow / screenshots / overwrote / previous / renderer / ms` |
| 照片（`lib/photo.js`） | HTTP 抓不到时的**磁盘兜底**：按 URL 末段文件名在 `<appDir>/data/uploads` 下递归找一份 |
| 桥（`lib/bridge.js`） | `local/export` 接受**实时草稿 `doc`**（面板里没保存的改动也会印出来）、`overwrite: overwrite|version`、`reveal`；新增 `local/plan`（导出前算路径与覆盖）、`local/reveal`（资源管理器选中）、`local/open`（默认程序打开）、`local/file`（只放行 `04-输出` 里的图片/PDF，给窗口里的缩略图用）；`local/render` 也接受 `{ id }` |
| 工具（`lib/tools.js`） | `resume_export` 走同一条导出作业，返回页数/体积/是否覆盖/截图；新增 `reveal` 参数。删掉 `tools.js` 里重复的 `updateIndex` / `resolveResumeId` |
| 面板 | 导出变成真正的窗口：简历 + 模板 + 照片状态、目录/文件名、**目标路径**、**覆盖提示**、**第一页缩略图**（同一份渲染）、三个勾选框（覆盖 / 打开文件夹 / 逐页截图）；导完不关窗，原地换成结果卡（页数 · 体积 · 用时 · 每页缩略图 · 打开文件夹 / 打开 PDF / 再导一次），串页时红字警告 |

契约写在 [`docs/EXPORT.md`](docs/EXPORT.md)，自检 `node tools/verify-export.mjs`（10 条断言：路径、覆盖、
版本副本、照片进 PDF、截图非空、索引、reveal 命令）。

**注意**：宿主侧 `lib/` 的改动要**重启 DSH** 才生效；面板 `client.js` 改完刷新页面即可。

## Unreleased — the experience library became an interview story bank

Ask: the resume only carries one XYZ line per job; the process detail (what the
situation was, what I owned, what I actually did, what the number was) has to be
rehearsed out loud before an interview. So each library entry can now carry STAR.

| Layer | What changed |
|---|---|
| Data (`lib/experiences.js`) | Optional `star = { situation, task, action, result }` on every item. All four are optional strings, default `''`. **Reading** an old entry fills the four keys in memory and never rewrites the file; `normalizeStar()` keeps exactly those four keys (others dropped), `String()`s + trims non-strings, clips each at 4000 chars. `title/period/category/description/tags` untouched. |
| Routes (`lib/bridge.js`) | No shape change: `GET experiences` returns items that now include `star`; `POST experiences/save` accepts it and still accepts requests that omit it (= four empty strings). |
| Panel (`client.js`) | Expanded card shows a 「STAR」 block under the description, but only the filled lines, and not at all when all four are empty. The form got four 3-row textareas with the same hints. A new 「口语稿」 button joins 编辑/删除: it joins S→T→A→R into one speakable paragraph (segments separated by 「。」, blank lines collapsed, empty segments skipped) and shows it in a tinted block with a 「复制」 button (clipboard API → `execCommand` fallback → "复制失败，请手动选择"). Collapsed rows are unchanged: title + period + category only. |

No new dependencies; `node --check` green on all five files.

## 0.4.0

### Added — the uploaded headshot can now be reframed

Reported as: *"上传图片的功能，但那个图片并不能调整位置"*. Correct — the panel could
upload, hide, remove, resize and round the photo, but the frame is `object-fit: cover`,
so a portrait was cropped at the centre and there was no way to say "show my forehead,
not my chin".

New document field and its three consumers:

| Where | What it does |
|---|---|
| `picture.position = { x, y }` | 0–100 percentages, exactly the two numbers CSS `object-position` takes. Missing → `50/50` (centre crop), so **old resumes render pixel-identically**. |
| Panel (`client.js`) | The 72 px frame is draggable: pointer-drag the photo and the deltas are converted to a focal point (drag right → see the left edge, i.e. `x` shrinks). Nine preset cells + a 居中 button do the same in one click. Both write through `setField('picture.position.x'|'.y')`, so the change rides the existing draft → 保存 → `local/update` path. |
| Renderer (`lib/render/compose.js`) | `photoPositionOf()` normalises (`null`, `''`, `NaN`, `-20`, `150` → clamped/washed to `50/50`…`0/100`) and the value is emitted as `object-position` on `<img class="ph">`. Preview and `local/export` share this one renderer, so the exported PDF crops like the preview. |

Preview also works **before** the host process is restarted: `applyPhotoPosition()` re-applies
the value to `img.ph` inside the preview `srcDoc` on every `load`, so the panel responds
immediately even while the host still runs the previous `compose.js`. Export needs the
restart because `local/export` renders in the host.

`lib/db.js` seeds `picture.position` on new resumes. New self-checks:
`tools/verify-photo-position.mjs` (renderer, 7 assertions) and a photo section in
`tools/verify-interaction.mjs` (9 assertions: default centre, preset grid, 居中, drag,
clamping, listener cleanup, and `picture.position` surviving into the save payload).

## 0.3.1

### Fixed — the panel opened onto HTTP 404 and an empty resume list

Symptom, exactly as reported: click the 简历 entry in the left rail and the page header
says

```
模板    读列表失败：HTTP 404
```

with `还没有简历` in the list, a preview stuck on `正在渲染预览…`, and every tool in the
conversation (`resume_doctor`, `resume_list`) working perfectly. `GET /resume-diag2` was
404 too, while the Reactive Resume service itself answered 200 on
`http://localhost:3000`.

The bridge registered its routes at the top of `registerBridge()`:

```js
const connection = ctx.get?.('connection')
if (connection === undefined) { warn; return }   // ← every route skipped
```

but the plugin row declares only `inject: ['tools','skills']`, so `apply()` is free to
run **before** `connection` exists. It did: the guard fired, zero routes were registered,
and Connection's shared-channel handler answers any unmatched path with
`new Response('not found', { status: 404 })` — which is precisely the 404 the panel showed.
`/resume-diag2` failed the same way through `ctx.get?.('webServer')`. Nothing was wrong with
the service, the database or the key.

Routes are now mounted through the host's optional injection, so they appear when the
service does rather than depending on load order:

```js
ctx.inject(['connection'], (inner) => mount(inner.connection ?? inner.get?.('connection')))
ctx.inject(['webServer'], (inner) => mountDiag(inner.webServer ?? inner.get?.('webServer')))
```

`mount`/`mountDiag` are idempotent (a reloaded `connection` does not re-register),
`dispatchAbort` moved out of `mount` so unmounting still cancels in-flight template
dispatches, and the hosts without `ctx.inject` keep the old immediate path.
`tools/verify-bridge-late.mjs` replays the ordering — apply with no services, then their
arrival — and fails the build if the routes stop appearing.

## 0.3.0

### Fixed — a delivered message without an identity corrupted the session log

The panel's "send to the agent" path built its message as

```js
{ role: 'user', content: [...], source: { kind: 'user' } }
```

with no `id`. The host does not mint one: `agent.followup()` stores the object verbatim in
`agent/inbox/spliced`, the step boundary writes it back out as a `user/message` event, and nothing
validates it at that point. The damage only surfaces on the *next* restore of that session:

```
stored session "session-…" is corrupt: … failed validation:
Error: session event at seq N lacks an identified message
```

Every message is now built by `createIdentifiedUserMessage()` (`id: randomUUID()`), and
`tools/verify-ask.mjs` asserts the identity, role, source marker and idempotency of what leaves the
bridge. This was plugin code, not configuration: no profile setting could have produced a valid
message out of an object that had no `id`.

### Fixed — messages landed in an arbitrary conversation

An empty `sessionId` used to fall back to `agents.list()[0]` — whichever agent happened to be
registered first in the host process, subagents included. Multi-tasking made that effectively random.
The panel now binds to the conversation it was opened from: the left-rail icon tracks
`uiSession.current` while the panel is closed and freezes the value on entry
(`useSessionTarget()`), because `uiSession.current` is derived from main-view retention and drifts
away as soon as the panel occupies `main`. `/ask` rejects an empty or dead target instead of guessing
(`400 target-required`, `409 session-not-live`). `tools/verify-target-binding.mjs` fails the build if
either old pattern returns.

### Fixed — template dispatch crashed on a missing AbortSignal

`subagents.startActivation()` dereferences `spec.signal` immediately
(`spec.signal.throwIfAborted()`), so an omitted signal surfaced as
`Cannot read properties of undefined (reading 'throwIfAborted')` wrapped in "dispatch failed". Both
dispatch paths now pass a real signal: a plugin-lifetime controller for the gallery route (aborted on
unload) and `exec.signal` for the tool.

### Fixed — the gallery never rendered custom templates

Thumbnails were produced for the 15 built-in ids only, so a saved custom manifest stayed on
"loading…" forever; its card also displayed the 31-hex id instead of the manifest's `label`. The
gallery now renders every id it lists, distinguishes "render failed" from "still loading", and labels
each card with `label`.

### Fixed — section headings ignored the resume's language

`SECTION_LABEL` was a hard-coded Chinese map, so a `de-DE` resume printed German body text under
Chinese headings. `labelsFor(locale)` now covers zh / en / de (including the "present" word) and falls
back to zh; the sheet follows `metadata.page.locale`, while the panel chrome keeps following the
Harness locale. `tools/verify-locale.mjs` pins this.

### Fixed — dangling layout references showed up as UUID chips

Reactive Resume keys custom sections by UUID. Deleting one leaves the id in `metadata.layout.pages`;
the renderer always filtered those, the layout board did not, so it rendered a raw id as a section
block. The board now filters against `doc.sections`, appends genuinely unplaced sections to the last
page, and labels each block via `sectionLabel(kind)` (the section's own `title` first).

### Added

- `resume_dispatch` — the lead fills `intent` / `resumeId` / `paths` / `excerpt`; a **fresh-context**
  `spawn` child reads the document, patches only those pointers, verifies and reports back through a
  completion notice. The brief is generated in code (`lib/worker-brief.js`), not by the model.
- `POST /api/resume-bridge/template-build` — the gallery dispatches a context-free template-builder
  directly (no lead hop). The brief reuses `resume_template(action=brief)` and requires `read_image`
  before the manifest is written.
- Section add / delete in the layout board with a confirmation step. Deletion removes the section,
  its items **and** every layout reference in the same draft, so a dangling id cannot be produced.
- Idempotency: `/ask` accepts `clientRequestId`; a replay returns `duplicate: true` without writing a
  second message.
- Messages carry `source.channel = "resume-panel"` while keeping `source.kind = "user"`
  (the chat UI's queued-message chip only matches `kind: "user"`).

### Changed

- `/ask` requires `sessionId` and answers `400 target-required` / `409 session-not-live`.
- Saving sends `sections` alongside `basics / summary / metadata / picture`, so section edits persist.
- Removed the dead `ResumeView` / `ResumeDock` components and the "export to chat" path — export is a
  local `printToPDF`, no model call and no chat message.

### Tests

`verify-local` · `verify-ask` · `verify-dispatch` · `verify-template-build` · `verify-target-binding` ·
`verify-locale` · `verify-layout` · `verify-interaction` · `verify-pages` · `verify-template-flow` ·
`verify-render`.
