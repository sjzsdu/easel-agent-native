# Chat — Agent Guide

Chat is the minimal chat-first agent-native app. The public root is a marketing
surface; the authenticated chat app starts at `/home`. Actions carry the real
capabilities, and screens exist only where a workflow needs durable UI around
the conversation.

## Skills

The default app skill surface is intentionally small. Promotion, learning,
translation, changelog, provider, and release workflows are optional; enable
the matching skill only when this app actually uses that workflow. The
`docs-search` action reads the version-matched framework docs bundled with
  `@agent-native/core`; `source-search` reads core and first-party template
  implementations. Prefer both over memory when package APIs, actions, or agent
  surfaces are involved.

## Core Rules

- UI feedback: target 100 ms, never exceed 400 ms; acknowledge before network work.
- Follow the root framework contract: data in SQL, actions first, application
  state for navigation/selection, and shared agent chat for AI work.
- Store large file/blob payloads in configured file/blob storage, not SQL: no
  base64, `data:` URLs, images, video/audio, PDFs, ZIPs, screenshots,
  thumbnails, or replay chunks in app tables, `application_state`, `settings`,
  or `resources`; persist URLs, ids, or handles instead.
- Never hardcode API keys, tokens, webhook URLs, signing secrets, private
  Builder/internal data, customer data, or credential-looking literals. Use
  secrets/OAuth/runtime configuration and obvious placeholders in examples.
- For external integrations, inspect the workspace/provider connection catalog
  first. Reuse an existing connection and its scoped credential resolver; only
  use app-local vault/OAuth/settings primitives when no reusable connection
  exists. Keep custom setup UI provider-specific and never duplicate storage.
- Keep actions deterministic and focused. Research, analysis, generation,
  recommendation, and synthesis start in the AgentSidebar and let the agent
  orchestrate its tools; follow-ups stay in the same thread rather than moving
  the user to a second freeform prompt box.
- Never fabricate. If an action fails or data is missing, say so and recover
  instead of inventing a result or claiming success.
- Verify a write before reporting it done — re-read the row or the screen.
- Use `view-screen` or application state when the active page/selection is
  unclear.

For a custom app, keep `server/plugins/config.ts` aligned with the product
brand. Its `app.name` is used in transactional emails, and its optional
`app.logoUrl` can point to an absolute HTTPS logo URL.

## Application State

- `navigation` describes the current view and selected entity ids. The default
  chat view is `chat` at `/home`; `/` is the public SSR marketing page.
- `navigate` moves the UI when the app supports it.
- `view-screen` is the first tool to call when the user's visible context
  matters.
- `provider-api-request` calls Slack through the shared workspace connection.
  Use `provider: "slack"` and an exact Web API path such as `/auth.test`.
  Missing access pauses the run and opens the contextual connection card; do
  not ask the user to paste credentials or replace the request with prose.

## Source Changes

Before building common workspace or agent UI, read `agent-native-toolkit`; read
`customizing-agent-native` before adapting shared UI.

- Guarded verification: run `pnpm agent-native:doctor`; fix findings before done.

## Easel Domain

Easel is a personal social-media ops workbench: discover → plan → produce →
publish → attribute. The agent chat is the primary surface; screens hold
durable state around it.

- **Skills live in `.agents/skills/easel-*`** (frontmatter `name` is the bare
  name, `layer` ∈ discover/plan/produce/publish/attribute/general) with shared
  knowledge and scripts in `.agents/shared/`. Skill descriptions are the
  routing surface — never name a skill that does not exist, and keep every
  cross-skill file path resolvable after renames.
- **Actions are the contracts**: `profile` / `profile-save` / `profiles` /
  `profile-set-active` (six-dimension profile), `trends`, `ideas` /
  `idea-save`, `calendar` / `calendar-save`, `outputs` / `output-file` /
  `output-file-save` / `output-manifest`, `quality-gate`, `skills-list`,
  and the Phase 2 publish pipeline: `publish-capabilities` /
  `publish-queue` / `publish-status` / `publish-records` /
  `publish-cancel` / `publish-retry`.
  Actions that belong on the first tool page must be registered in
  `server/plugins/agent-chat.ts` `INITIAL_TOOL_NAMES`.
- **Profile-first**: read `profile` before creative work; patch dimensions via
  `profile-save`. There is no file-based profile format — never reintroduce
  `identity.md`, `style.md`-style files or `=== EASEL ACCOUNT PROFILE ===`
  markers; reference `profile.identity` / `profile.style` / … instead.
- **Outputs contract**: deliverables live under `outputs/<topic>/`, written
  with `output-file-save` (path relative to `outputs/`); progress is recorded
  as `output-manifest` steps (layer/skill/status), project status moves
  draft → ready → published. Text deliverables do not go into chat.
- **Publishing goes through `publish-queue` (Phase 2)**: quality-gate
  (verdict=block hard-blocks enqueueing) → `publish-queue` (immediate or
  scheduled) → in-process scheduler executes due jobs with bounded
  exponential-backoff retries → success writes `publish_records` (audit
  trail with a `metrics` field reserved for Phase 3 attribution), flips
  `content_items` / manifest status to `published`, and updates the linked
  `calendar_events` row. Platform adapters live in `server/lib/publish/`
  behind a single Publisher contract; platforms without an integrated API
  declare `not_implemented` — tell the user that platform does not support
  automatic publishing yet and never fake a queued or successful publish.
  Never claim a publish succeeded unless `publish-status` /
  `publish-records` show it. Media-generation dependencies missing
  (edge-tts / faster-whisper / playwright / ffmpeg) still degrade honestly.
- **Single-user by design**: the SQL tables (`profiles`, `ideas`,
  `calendar_events`, `content_items`, `publish_jobs`, `publish_records`)
  carry no tenant columns for P1/P2; they are
  listed in `agent-native.json` `doctor.dbToolScopingDenylist` with that
  reason. App-level output dir overrides read `process.env.EASEL_OUTPUTS_DIR`
  locally and must not grow into credential access.
- **Verification chain**: `pnpm typecheck` → `pnpm agent-native:doctor` →
  `pnpm action <name>` smoke (e.g. `trends`, `skills-list`) → `pnpm test` →
  `pnpm dev` page smoke.
