# J.A.R.V.I.S. Project Handover

## Project and purpose

J.A.R.V.I.S. is a cross-platform personal assistant: a Node.js-served browser/PWA application with chat, browser speech, optional AI providers, local productivity features, a holographic dashboard, and an optional Electron desktop shell.

## Repository and environment

- Repository: `kkhan86309393-crypto/Jarvis-by-khan`
- Local path: `/workspaces/Jarvis-by-khan`
- Development environment: Linux workspace / VS Code Codespace
- Current working branch: `feature/jarvis-audit-completion-20261102`, based on the published `backup/jarvis-handoff-20261030` tip `c9c2888`.
- The local `backup/jarvis-handoff-20261030` branch remains unchanged at `02877f1`. The remote backup tip was fetched and verified at `c9c2888`; audit changes are uncommitted and have not been pushed.
- Base commit: `924d9217a064f7649931cd0bf9e571bf3aa900f6`
- Progress snapshot commit: `9a5d62c96a70ba3918acc84bf0df3730178e1b25` (`Save JARVIS progress and prepare project handover`)
- Remote: `origin` → `https://github.com/kkhan86309393-crypto/Jarvis-by-khan`
- The feature branch is based on `origin/backup/jarvis-handoff-20261030`; publishing the feature branch requires explicit user approval. No push or merge was performed.

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
- `public/lab-*.js`: LAB personalization, AI Modify interface, Code Studio, extensions, and safety/recovery modules.
- `desktop/`: Electron main/preload and validated IPC boundaries.
- `test/`: unit, integration, server, speech, avatar, and service-worker tests.
- `public/avatar3d.bundle.js`: generated build output, ignored by Git; do not stage it.

## Worktree state and included snapshot

The progress snapshot contains the approved project changes below. The following tracked paths were modified:

Modified tracked files:

`README.md`, `package-lock.json`, `package.json`, `public/app.js`, `public/avatar3d.js`, `public/chat-context.js`, `public/diagnostics.js`, `public/index.html`, `public/service-worker.js`, `public/speech-input.js`, `public/styles.css`, `test/avatar3d.test.js`, `test/chat-context.test.js`, `test/diagnostics.test.js`, `test/server.test.js`, `test/service-worker.test.js`, and `test/speech-input.test.js`.

Deleted tracked file (user confirmed it is an intentional replacement):

`public/file_00000000f9a4821182e42efc9a2e93a0.png` (the committed file is a 1214×1295 RGB PNG). The current UI now points at `public/jarvis-portrait.png`; the user confirmed that this deletion is intentional and should be published.

Untracked source/tests:

`public/local-memory.js`, `public/local-planner.js`, `public/smart-command-router.js`, `public/portrait-animation.js`, `test/local-memory.test.js`, `test/local-planner.test.js`, `test/smart-command-router.test.js`, and `test/portrait-animation.test.js`.

Untracked image staging decisions confirmed by the user:

- Include `public/jarvis-portrait.png` (1199×1312 RGBA; current portrait reference).
- Keep `public/a_clean_cutout_portrait_image_on_a_transparent_bac-1.png` and `public/jarvis-portrait.png.png` local and untracked; both are exact byte duplicates of `jarvis-portrait.png` (same SHA-256).
- Keep `public/a_high_detail_sci_fi_holographic_tech_illustration.png` (1269×1240 RGBA; unused concept illustration) local and untracked.
- Keep `public/file_000000003c208208acf876139a63a9f6.png` (724×2172 RGB; mobile screenshot/reference) local and untracked.

The four excluded image references remain local, untracked, and unstaged. `.env`/`.env.*`, key files, `node_modules/`, and generated avatar bundle are ignored. No credentials or environment files appeared in the tracked change listing. The older `HANDOFF.md` is an earlier snapshot and does not reflect this current worktree; prefer this document.

## Completed project work represented in the worktree

- Expanded responsive holographic dashboard and optional local Three.js avatar/Earth projection.
- Browser speech recognition, wake phrase handling, synthesis lifecycle tracking, and opt-in diagnostics.
- Local planner, notes/tasks, memory, and smart command routing modules with focused tests.
- Expanded LAB interface and safeguards; user-provided code/extension content remains inert.
- Static portrait updated in the current UI to a transparent cutout image.
- Portrait animation state hook wired to speech lifecycle; details below.

Those earlier implementation changes are committed in the progress snapshot above. The separate audit changes below are uncommitted on the feature branch.

## Portrait blinking and lip-sync status

`public/jarvis-portrait.png` is a flattened 1199×1312 RGBA portrait without separate eyelids/lips or a facial rig. `public/portrait-animation.js` provides an isolated event interface and state controller:

- Unscheduled-by-speech, irregular staged blink state; respects `prefers-reduced-motion`.
- Approximate viseme state only while speech playback is active.
- Mouth state resets on pause, end, error, timeout, and cancellation; playback identifiers reject stale callbacks.
- Speech lifecycle is wired from `public/app.js`; optional 3D avatar controls remain separate.

The static portrait now has visible, approximate blink and mouth-shape changes made from transparent overlays sized to the full portrait canvas. Blink frames are staged open/half/closed/reopening, and mouth states change only while speech is active and speech-boundary cues arrive. Reduced-motion handling disables both overlays, and the canonical portrait remains unchanged. This is not phoneme-accurate lip-sync or a photorealistic eyelid reconstruction.

Automated tests confirm all seven overlays are 1199×1312 RGBA assets and are served/cached by the app. Actual visual alignment and Android rendering still require a browser/device check; the closed-eye reference and screenshots are not loaded as production portrait frames.

## Validation

Prior validation on the published backup branch:

- `npm run check`: passed, including avatar bundle build and JavaScript syntax checks.
- `node --test test/portrait-animation.test.js test/server.test.js test/service-worker.test.js`: passed, 52 tests, 0 failures.
- `git diff --check`: passed.

The test suite prints expected simulated upstream/API failures from negative-path tests; the final suite status is still 199/199 passing.

Audit update (2026-11-02):

- Fixed duplicate-text playback handling so an utterance that did not emit `onstart` cannot be reported as successfully spoken.
- Registered the speech voice-change listener before startup settings synchronization and added a diagnostic voice count.
- Bound portrait/3D animation cleanup to non-persisted page teardown while preserving animation on back-forward-cache restores.
- Bumped the app-shell cache to `jarvis-shell-v74`; it precaches the updated app script and the local facial overlays, and excludes API paths.
- `node --test`: 202 tests passed, 0 failed, 0 skipped. The focused voice/avatar/desktop/PWA/server suite passed 121/121.
- JavaScript syntax checks and `git diff --check` passed. `npm run check` was not run because it rewrites the protected generated avatar bundle.
- Static Electron/IPC and PWA/manifest checks are automated. Real Android Chrome speech/PWA checks and Windows packaging/OS behavior remain pending on those devices.
- Changes remain uncommitted on the feature branch. The published backup branch is unchanged; do not push without user approval.

## Remaining work and safe sequence

1. Ask for approval before publishing the feature branch; verify the remote backup tip again before any push. Never force-push or overwrite remote commits.
2. Keep the four explicitly excluded untracked reference images local unless the user later approves adding them. The canonical portrait and approved overlays are tracked on the remote backup branch.
3. Test Android Chrome speech replay/wake-word behavior and the PWA offline flow on the target device; browser tests cannot establish actual speaker output or OS-level recognition reliability.
4. Run Windows packaging and OS-level Electron checks on Windows before distribution.

## Instructions for the next ChatGPT account

Continue in this **same existing repository and branch/history**. Do not initialize a new repository, recreate the project, or replace its existing files. First inspect `git status`, `git branch --show-current`, `git remote -v`, and the latest commits. Preserve any uncommitted changes. The implementation snapshot is already committed locally; the push is pending GitHub authentication. Verify remote history and push normally only if it remains a fast-forward.
