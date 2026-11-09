<div align="center">

# dsh-resume-assistant

> Native AI-first resume workbench for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Full-page editor in the left rail, conversation one keystroke away, and agents that edit via structured JSON Pointers instead of guessing coordinates.

![Version](https://img.shields.io/badge/version-0.4.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![Node](https://img.shields.io/badge/node-%3E%3D20.18-brightgreen)
![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.0--rc.2-orange)

</div>

A DeepSeek Harness plugin that turns a local Reactive Resume + portable PostgreSQL installation into a first-class, AI-native resume workbench. You edit visually; the agent edits precisely; the service starts itself.

> Independent project. Not affiliated with Reactive Resume. It talks to a local instance and reimplements layout in HTML/CSS. See [NOTICE](NOTICE).

## Why it exists

Most resume tools are either a click-heavy web app or a chat that cannot reliably touch your data. This plugin puts both in one window:

- **You edit** — form fields, 15+ templates, language, typography, photo, live A4 preview.
- **The agent edits** — double-click a block or select a word; the agent receives a JSON Pointer (e.g. `/sections/experience/items/2`) and patches exactly that spot.
- **It runs itself** — the plugin boots the local PostgreSQL + app service on activation.

## Features

| Feature | Description |
|---|---|
| **Left-rail full-page editor** | Real panel (`main/resume`) in the Harness Web UI. Resizable list · form · A4 preview columns. |
| **No login, no API keys** | Direct read/write of `resume.data` (jsonb). Upstream auth and dashboard are bypassed. |
| **Shared rendering engine** | 15 built-in template manifests + custom ones. Preview and PDF export use the exact same HTML/CSS layout. Section headings follow the resume’s own `metadata.page.locale` (zh / en / de). |
| **Document-level quoting** | Double-click block → JSON Pointer. Drag-select word → word + owning block. Both arrive in chat as structured requests. |
| **Live style controls** | Line height, photo radius, page margins, sidebar width as document-bound sliders. |
| **Headshot reframing** | `object-fit: cover` photo box. Drag inside the frame or pick one of nine presets; focal point is stored in `picture.position` so preview and PDF crop identically. |
| **Template authoring by example** | Upload a screenshot in the gallery → context-free subagent (`/template-build`) produces a validated manifest that appears immediately. |
| **One-click local export** | Host drives headless Chrome/Edge → `04-输出/<name>/<name>-CV.pdf` + per-page PNGs, index updated, file selected in Explorer. Pre-export window shows path, overwrite warning, and live first-page thumbnail. See [`docs/EXPORT.md`](docs/EXPORT.md). |
| **Bound conversation** | Panel sends to the conversation it was opened from (`uiSession.current` snapshot). Unbound or archived targets fail loudly. |
| **Worker dispatch** | Bulk layout/wording goes through `resume_dispatch` to a fresh-context child agent. Lead decides *what*; child reads and patches. |
| **Service lifecycle** | `resume_service(start\|stop\|status)`. Auto-start on activation via `pg_ctl` + detached node. |

## Quick Start

**Prerequisites**

- DeepSeek Harness ≥ 0.2.0-rc.2
- Node.js ≥ 20.18
- A local Reactive Resume checkout + portable PostgreSQL under `~/Documents/简历助手`  
  (`01-应用/reactive-resume`, `02-数据库/pg`, `03-脚本/rr-cv.mjs`). Override with `projectRoot` or `RESUME_ASSISTANT_HOME`.

**Install**

```bash
# From Harness UI: Plugins → install from path
# or
plugin_manager install_bundle <absolute-path-to-this-directory>
```

Activate the plugin. The local service starts automatically after ~1.5 s. Open the left-rail “简历” entry for the full-page editor.

## Tools exposed to the agent

`resume_service` · `resume_doctor` · `resume_list` · `resume_show` · `resume_dispatch` · `resume_patch` · `resume_photo` · `resume_export` · `resume_new` · `resume_template`

- `resume_dispatch` is the preferred editing path: lead supplies `intent` / `resumeId` / `paths` / `excerpt`; a fresh-context child reads the document, patches only those pointers, verifies, and reports back.
- `resume_template(action=brief)` emits a complete code-generated task brief (schema, constraints, acceptance commands) that becomes the prompt for a template-building subagent.
- A runtime skill `resume-assistant` is registered automatically.

## Usage highlights

1. Open the left-rail panel → pick or create a resume.
2. Edit in the form or drag sections between columns / pages. Changes stay in the draft until you save (previous document is backed up).
3. Double-click a block or select text to quote it into the conversation as a structured path.
4. Ask the agent to rewrite, restyle, or add content — it receives precise JSON Pointers.
5. Export PDF locally (no model call). The window previews the first page and warns about overwrites.
6. Generate new templates by uploading a reference screenshot.

## Verify locally

```powershell
node tools/verify-local.mjs
node tools/verify-render.mjs --demo
node tools/verify-pages.mjs
node tools/verify-interaction.mjs
node tools/verify-template-flow.mjs
node tools/verify-ask.mjs
node tools/verify-dispatch.mjs
node tools/verify-target-binding.mjs
node tools/verify-locale.mjs
node tools/verify-layout.mjs
# … and others in tools/
```

## Design notes

- Link installs do not hot-swap ESM; toggle the plugin or hard-refresh the client.
- All bridge routes live under `/api/resume-bridge`. Anything else 404s silently.
- Event-handler exceptions do not reach error boundaries; interaction tests catch dead buttons.
- Free-form absolute canvas was deliberately removed; layout is flow-based via column order + manifests.
- Messages must carry a stable `id` (`createIdentifiedUserMessage`) so session restore never fails with “lacks an identified message”.
- Panel chrome follows Harness locale; sheet headings follow the resume’s own locale.
- Section add/delete is atomic: the section object and all layout references are updated together.

## Changelog

See [CHANGELOG.md](CHANGELOG.md). Version 0.4.0 continues the line of fixes around export reliability, message identity, session binding, and section lifecycle.

## License

MIT — see [LICENSE](LICENSE). Templates are an independent HTML/CSS interpretation; no upstream source is included.

## Acknowledgments

- Host: [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
- Layout inspiration: Reactive Resume (descriptive use only; not affiliated)
- Local service: portable PostgreSQL + self-hosted Reactive Resume instance
