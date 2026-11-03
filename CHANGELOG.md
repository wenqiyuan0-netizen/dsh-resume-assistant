# Changelog

All notable changes to this plugin. Versions follow the DSH plugin compatibility range in `package.json`.

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
