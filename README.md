# dsh-resume-assistant

A **native, AI-first resume workbench for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)**: a left-rail panel opens a full-page editor, the conversation stays one keystroke away, and an agent can read and rewrite the resume through **structured paths** instead of guessing coordinates.

> Independent project. Not affiliated with Reactive Resume; it talks to a local instance and reimplements layout in HTML/CSS. See [NOTICE](NOTICE).

---

## Why it exists

Resume tools are either a web app you click through, or a chat that can't touch your data. This plugin puts both in one window:

- **You edit** — form fields, 15 templates, language, typography, photo, all live-previewed at A4.
- **The agent edits** — point at a block, quote a word, or name a style property; the agent receives a JSON Pointer (`/sections/experience/items/2`) and patches exactly that spot.
- **It runs itself** — the plugin boots the local PostgreSQL + app service on activation, so a restart is all it takes.

## Features

| | |
|---|---|
| **Left-rail entry, full-page editor** | Rendered in the Harness Web UI as a real panel (`main/resume`), not an overlaid iframe hack. List · preview · form, all three columns resizable. |
| **No login, no API keys** | Reads and writes the resume document straight from `resume.data` (jsonb). The upstream app's auth, dashboard and API-key dance are simply not on the path. |
| **Self-hosted rendering** | 15 template manifests + one HTML/CSS engine. Preview and PDF export share the exact same layout, so what you see is what you export. |
| **Document-level quoting** | Double-click a block → JSON Pointer. Drag-select a word → word + owning block. Both land in the chat as a structured request. |
| **Real style controls** | Line height, photo radius, page margins, sidebar width are sliders bound to the document — drag, see it, save. |
| **Template authoring by example** | Upload a screenshot from the template gallery → an agent (isolated context, code-built brief) writes a manifest → it is validated, saved and appears in the gallery. |
| **One-click export** | Chromium `printToPDF` in the host process → `04-输出/<name>/<name>-CV.pdf`, path copied to clipboard. |
| **Service lifecycle** | `resume_service(start|stop|status)`; auto-start on activation; `pg_ctl` + detached node, so nothing dies with a tool call. |

## Install

```bash
# from the Harness UI: Plugins → install from path
# or
plugin_manager install_bundle <absolute-path-to-this-directory>
```

Requires a local **Reactive Resume** checkout plus a portable PostgreSQL under `~/Documents/简历助手`
(`01-应用/reactive-resume`, `02-数据库/pg`, `03-脚本/rr-cv.mjs`). Override with `projectRoot` /
`RESUME_ASSISTANT_HOME`.

## Tools exposed to the agent

`resume_service` · `resume_doctor` · `resume_list` · `resume_show` · `resume_patch` · `resume_photo` ·
`resume_export` · `resume_new` · `resume_template`

`resume_template(action=brief)` prints a complete, code-generated task brief (schema, allowed values,
constraints, acceptance commands, reporting format) — that text **is** the prompt for a template-building subagent.

## Design notes worth knowing

- **`link:` installs do not hot-swap ESM.** Toggling the plugin off/on re-imports fresh code; a page refresh (`Ctrl+Shift+R`) reloads the client half. That is how this repo was developed without restarting the app dozens of times.
- **Routes live under `/api`.** `ctx.connection.fetch` registers exact routes on the shared `/api` channel — anything else 404s silently, which looks exactly like "the button does nothing".
- **Event-handler exceptions don't reach error boundaries.** A `ReferenceError` inside `onClick` produces a dead button and a console line, nothing more. `tools/verify-interaction.mjs` renders the panel with a stub React and clicks the buttons, so this class of bug is now a failing test instead of a mystery.
- **Free-form canvas was removed.** Absolute positioning without measured heights overlaps text; a document is a flow, not a poster. Column order + template manifests cover the real need.
- **Failure surfaces are explicit.** Panel crashes render the stack; preview failures print the reason; unverified paths are labelled as such.

## Verify locally

```powershell
node tools/verify-local.mjs            # tool schemas, registration, Config
node tools/verify-render.mjs --demo    # all 15 templates render
node tools/verify-pages.mjs            # layout.pages → N A4 sheets
node tools/verify-skins.mjs <id>       # decorations really differ per template
node tools/verify-interaction.mjs      # headless click-through of the panel
node tools/verify-template-flow.mjs    # brief → save → render → delete
```

## License

MIT — see [LICENSE](LICENSE). Templates are an independent HTML/CSS interpretation; no upstream source is included.

---

## 中文说明

这是一个给 **DeepSeek Harness** 用的**原生、AI 优先的简历工作台**：左栏一个入口打开整页编辑器，对话随时切回；agent 通过**结构化路径**读写简历，而不是猜坐标。

- **你改**：表单、15 个模板、语言、字体字号、照片，右侧 A4 实时预览
- **agent 改**：双击一块 → 拿到 `/sections/experience/items/2`；拖选一个词 → 词 + 所属块；两者都作为结构化请求进入对话
- **自己起服务**：插件激活即拉起本机 PostgreSQL + 应用，重启即可用；不需要登录，也不需要 API key
- **模板按案例生成**：模板画廊里上传一张截图 → 隔离子 agent（提示词由代码拼装）产出 manifest → 校验、保存、直接出现在画廊

安装：把本目录作为 bundle 装进 profile；需要一个本地 Reactive Resume + 便携版 PostgreSQL。

## Deutsche Kurzbeschreibung

Ein **nativer, KI-first Lebenslauf-Arbeitsplatz** für den DeepSeek Harness: Eintrag in der linken Leiste, ganzseitiger Editor, Chat bleibt einen Klick entfernt.

- **Sie bearbeiten**: Formular, 15 Vorlagen, Sprache, Typografie, Foto — mit A4-Live-Vorschau
- **Der Agent bearbeitet**: Block doppelklicken → JSON Pointer; Wort markieren → Wort + Block; beides geht als strukturierte Anfrage in den Chat
- **Kein Login, kein API-Key**: liest und schreibt `resume.data` (jsonb) direkt
- **Vorlagen nach Beispiel**: Screenshot hochladen → isolierter Subagent (Prompt per Code erzeugt) schreibt ein Manifest → validiert, gespeichert, in der Galerie verfügbar

## Résumé en français

Un **atelier de CV natif et pensé pour l'IA** dans DeepSeek Harness : une entrée dans la barre latérale, un éditeur pleine page, la conversation toujours à un clic.

- **Vous éditez** : formulaire, 15 modèles, langue, typographie, photo, aperçu A4 en direct
- **L'agent édite** : double-clic sur un bloc → pointeur JSON ; sélection d'un mot → mot + bloc ; tout arrive dans le chat comme demande structurée
- **Sans connexion ni clé API** : lecture/écriture directe de `resume.data` (jsonb)
- **Modèles à partir d'exemples** : téléversez une capture → un sous-agent isolé (invite générée par code) produit un manifeste → validé, enregistré, ajouté à la galerie
