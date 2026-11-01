# J.A.R.V.I.S. Project Handover

## Project and purpose

J.A.R.V.I.S. is a cross-platform personal assistant: a Node.js-served browser/PWA application with chat, browser speech, optional AI providers, local productivity features, a holographic dashboard, and an optional Electron desktop shell.

## Repository and environment

- Repository: `kkhan86309393-crypto/Jarvis-by-khan`
- Local path: `/workspaces/Jarvis-by-khan`
- Development environment: Linux workspace / VS Code Codespace
- Current branch verified before this documentation update: `main`.
- The working tree was already dirty before this documentation update. Its verified inventory is recorded below; preserve those changes.
- No remote, upstream, or push status is asserted here.

## Technologies

- Node.js 22+ and native ES modules
- Browser HTML, CSS, JavaScript, Web Speech APIs, and service worker/PWA support
- Three.js and `@pixiv/three-vrm` for optional local avatar and holographic Earth rendering
- Optional Electron shell
- Node's built-in `node:test` runner and esbuild

## Main files

- `server.js`: application server and backend/API routes.
- `public/index.html`, `public/styles.css`: application markup and responsive interface.
- `public/app.js`: client startup, chat, voice playback/recognition, dashboard, and feature integration.
- `public/speech-input.js`: browser speech recognition/synthesis helpers and lifecycle logic.
- `public/diagnostics.js`: opt-in, page-local speech/runtime diagnostics (`?diagnostics=1`).
- `public/avatar-cues.js`: approximate speech-boundary viseme cue helpers.
- `public/portrait-animation.js`: isolated blink/viseme state controller and `jarvis:portrait-animation` event interface.
- `public/avatar3d.js`: optional Three.js avatar/Earth renderer and local VRM/GLB handling.
- `public/service-worker.js`: PWA shell caching.
- `public/local-memory.js`, `public/local-planner.js`, `public/smart-command-router.js`: browser-local memory, tasks/notes, and command routing.
- `public/focus-timer.js`: browser-local focus timer persistence.
- `public/news-briefing.js`: source-backed Search and Briefing normalization/rendering.
- `public/ui-localization.js`: English/Hindi interface text translation.
- `public/lab-*.js`: LAB personalization, AI Modify interface, Code Studio, extensions, and safety/recovery modules.
- `desktop/`: Electron main/preload and validated IPC boundaries.
- `test/`: unit, integration, server, speech, avatar, and service-worker tests.
- `test/dashboard-mobile-layout.test.js`: mobile command bar cascade and fixed-navigation clearance regression.
- `test/startup-storage.test.js`: guarded localStorage getter startup regression.
- `public/avatar3d.bundle.js`: generated build output, ignored by Git; do not stage it.

## Verified worktree state

At the start of this documentation update, `git status --short` reported these tracked modified files:

`HANDOVER.md`, `README.md`, `package-lock.json`, `public/app.js`, `public/avatar3d.js`, `public/index.html`, `public/service-worker.js`, `public/styles.css`, `test/avatar3d.test.js`, `test/lab-navigation.test.js`, `test/server.test.js`, and `test/service-worker.test.js`.

It reported these untracked source and test files:

`public/focus-timer.js`, `public/news-briefing.js`, `public/ui-localization.js`, `test/chat-ui-regression.test.js`, `test/dashboard-mobile-layout.test.js`, `test/focus-timer.test.js`, `test/navigation-ui-regression.test.js`, `test/news-briefing.test.js`, `test/startup-storage.test.js`, `test/ui-localization.test.js`, and `test/vision-ui-regression.test.js`.

`package-lock.json` was already modified; preserve it. `public/jarvis-portrait.png` was not listed as modified. This is a point-in-time inventory taken before editing these two documentation files; it is not a claim about a later worktree state.

## Completed project work represented in the worktree

- Expanded responsive holographic dashboard and optional local Three.js avatar/Earth projection.
- Browser speech recognition, wake phrase handling, synthesis lifecycle tracking, and opt-in diagnostics.
- Local planner, notes/tasks, memory, and smart command routing modules with focused tests.
- Expanded LAB interface and safeguards; user-provided code/extension content remains inert.
- English/Hindi UI localization with preference persistence, source-backed News/Briefing result rendering, and local focus timer persistence.
- Gemini, Ollama, and OpenAI-compatible server-side adapters, with per-request selected-provider validation and no silent cross-provider fallback.
- Electron Gemini **Save & Lock**, explicit unlock/change/lock controls, OS-backed encrypted key storage, and browser/server-session-only key handling.
- Mobile command-bar cascade fix: one mobile sticky rule and additional dashboard bottom clearance while preserving the fixed navigation.
- Portrait animation state hook wired to speech lifecycle; details below.

These features are present in the current working tree; this note does not assert that they are committed.

## Portrait blinking and lip-sync status

`public/jarvis-portrait.png` remains an unchanged, flattened 1199×1312 RGBA portrait without separate eyelids/lips or a facial rig. `public/portrait-animation.js` provides an isolated event interface and state controller:

- Unscheduled-by-speech, irregular staged blink state; respects `prefers-reduced-motion`.
- Approximate viseme state only while speech playback is active.
- Mouth state resets on pause, end, error, timeout, and cancellation; playback identifiers reject stale callbacks.
- Speech lifecycle is wired from `public/app.js`; optional 3D avatar controls remain separate.
- The dashboard's **Load Custom Avatar** picker accepts local, self-contained VRM/GLB files up to 20 MB; unsupported or invalid rigs report an error without uploading the file.

CSS overlays now create staged eyelid blinks and approximate viseme mouth movement over the unchanged portrait. The overlays are hidden at rest, return to neutral after speech, and are disabled for reduced-motion preferences. This is a lightweight visual approximation, not facial reconstruction or phoneme-accurate lip sync. The JPG/reference and screenshot assets are not pixel-aligned facial overlays and must not be used as live animation frames.

## Validation

Verified validation status before this documentation update:

- The explicitly selected API-free regression suites passed: 198 tests, 0 failures. This run preceded the guarded localStorage startup change below.
- After that change, the focused startup-storage and LAB navigation tests passed: 4 tests, 0 failures.
- `git diff --check` passed after the focused startup-storage change.
- A full test run and `npm run check` have not been run after the latest code changes. `npm run check` rebuilds the avatar bundle.
- Chrome/browser/device visual and permission testing is still pending; no browser/device test is claimed as complete here.

## Remaining work and safe sequence

1. Complete remaining non-API work and review its regression coverage while preserving the existing working-tree changes.
2. Perform the pending browser/device checks when requested, including mobile command-bar clearance, portrait/Earth/custom model rendering, speech permissions/output, persistence, Vision stop behavior, and PWA/offline behavior.
3. Gemini, Ollama, and OpenAI-compatible integrations are implemented in the current worktree and covered by API-free mocked regression tests. No live provider calls or browser/device validation are claimed; browser/device checks remain pending.

## Instructions for the next ChatGPT account

Continue in this **same existing repository and branch/history**. Do not initialize a new repository, recreate the project, or replace its existing files. Recheck branch and worktree before making current-state claims, preserve all pre-existing changes, and do not infer push or remote status from this handover. Browser/device validation is pending. Provider integrations exist in the current worktree; do not make real provider requests without explicit authorization.
