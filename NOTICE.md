# NOTICE

## Upstream compatibility

This plugin works against a **local installation** of [Reactive Resume](https://github.com/AmruthPillai/Reactive-Resume),
which is licensed under the **MIT License** (Copyright © 2026 Amruth Pillai).

MIT permits use, modification, redistribution and sublicensing provided the copyright
notice and permission notice are retained. Findings that shaped this project's publishing posture:

- **License is MIT, not copyleft.** Publishing an independent plugin that talks to a local
  instance is compatible; no source license obligations are triggered for this repository.
- **No upstream source is vendored here.** `lib/render/**` is an independent HTML/CSS
  interpretation of common resume layouts. Template *names* match upstream names only so that
  existing documents keep resolving; no template component code is copied.
- **The app itself is not distributed.** Users bring their own checkout plus a portable
  PostgreSQL; this repository contains no application bundle, no database and no user data.
- **One runtime patch is documented, not hidden.** To embed the app's page, its root document
  header `X-Frame-Options: DENY` is removed from the local build (backed up as
  `index.mjs.dsh-orig`, re-applied idempotently on start). That is a local modification of the
  user's own installation; see `lib/patch-app.js`.
- **Trademark / affiliation.** "Reactive Resume" is used descriptively only. This project is
  not affiliated with or endorsed by the upstream author.

## Data

No resume content, no database dump, no API key and no export artifact is included in this
repository. Sample content in documentation uses a fictional persona ("Zhang San").

## Third-party names

DeepSeek Harness and Reactive Resume are the property of their respective owners.
