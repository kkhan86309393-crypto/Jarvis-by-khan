# J.A.R.V.I.S. Project Handoff

## Repository snapshot

- Repository: `kkhan86309393-crypto/Jarvis-by-khan`
- Handoff branch: `backup/jarvis-handoff-20261030`
- Remote: `origin` (`https://github.com/kkhan86309393-crypto/Jarvis-by-khan`)
- Before handoff, the worktree was on `backup/jarvis-transfer-20261029-2131z`, tracking its matching `origin` branch. It had 12 modified tracked files and 14 untracked source/test files; none were staged. The requested handoff branch did not exist locally or remotely.
- The only ignored project asset outside `node_modules/` is the generated `public/avatar3d.bundle.js`; it is intentionally excluded from handoff staging. Dependency files under `node_modules/` are also ignored.
- The project change set contains no environment files or real credentials. Secret-redaction tests use synthetic fixtures.
- Pre-handoff verification: `node --test` passed 162/162 tests; source JavaScript syntax checks passed; `git diff --check` passed.

## Overview and architecture

J.A.R.V.I.S. is a Node-served browser/PWA assistant with an optional Electron desktop shell.

- `server.js` serves the app and API routes, and connects chat/search requests to optional server-configured AI providers.
- `public/app.js` coordinates the browser UI, chat, preferences, voice, LAB navigation, and feature modules.
- `public/speech-input.js` contains speech recognition, speech synthesis, wake phrase, and lifecycle helpers.
- `public/diagnostics.js` provides opt-in, in-page runtime and speech diagnostics at `?diagnostics=1`.
- LAB behavior is split into `public/lab-personalize.js`, `public/lab-ai-modify.js`, `public/lab-code-studio.js`, `public/lab-extensions.js`, and `public/lab-safety.js`.
- `public/service-worker.js` caches the application shell for PWA/offline viewing.
- `desktop/` contains the optional Electron main/preload and validated IPC boundaries.
- `test/` uses Node's built-in test runner for unit, integration, server, diagnostics, LAB, and service-worker checks.

## Completed features

- Original JARVIS chat/dashboard interfaces, shared settings, responsive layouts, and PWA support.
- Browser speech recognition, wake phrase handling, and speech synthesis integration.
- J.A.R.V.I.S. LAB navigation and Personalize, AI Modify, Code Studio, Extensions, and Safety & Recovery panels.
- LAB preferences are separate from existing JARVIS preferences.
- AI Modify currently presents an interface/status/history only; it does not generate or write project changes.
- Code Studio imports and exports local text as inert code; it does not execute code or change project files.
- Extensions metadata can be imported and managed as untrusted data; imported code is never loaded or executed.
- Diagnostics report speech lifecycle metadata without storing transcripts.
- AI-response TTS fallback: if an AI response's utterance does not fire `onstart`, its message offers **Tap to Replay**. The click invokes the existing speech function in a user gesture. The button is guarded against repeat clicks and is removed after successful playback. Preview Voice remains unchanged.

## Android TTS status and investigation

The reported Android Chrome device has audible **Preview Voice** playback, but normal AI responses have been silent. The app receives the AI reply and passes it through the same speech function used by Preview Voice. An AI response is normally queued after the asynchronous network response; preview runs directly in a click handler. If recognition is active, AI speech waits until recognition stops. The timing/user-gesture difference is a plausible browser playback restriction, not a confirmed device root cause.

Current TTS diagnostics record selected voice name/language, synthesis `speaking`/`pending`/`paused` state, utterance queue/start/end/error, timing, start timeout, and skip/defer reasons. An `onend` without `onstart` is no longer treated as proof that playback started. Diagnostics are enabled with `?diagnostics=1` and are held in a page-local in-memory log.

**Pending:** test the AI-response replay button on the target Android Chrome device. Capture the diagnostics log for an automatic response and for a replay click; record whether each fires `onstart`, `onend`, or `onerror`, and whether replay is audible. Browser events cannot prove sound reached the speaker; device volume and audio routing also need checking. Do not claim the issue is fixed based solely on a successful `onend`.

## Known issues and next steps

1. Validate AI response speech and **Tap to Replay** on Android Chrome with `?diagnostics=1`.
2. Compare automatic and user-gesture playback events and note selected voice, state, and error/timing.
3. If replay succeeds where automatic playback fails, retain the gesture fallback and document device/browser behavior. If both fail despite `onstart`, investigate Android system TTS and audio routing rather than replacing the speech engine.
4. Android recognition and continuous wake-word availability remain dependent on Chrome, the OS, and the browser speech service; device-level behavior is not guaranteed by unit tests.
5. LAB project-file modification, actual backups/rollback, generated-code execution, and extension runtime execution are intentionally not implemented.

## Resume development

From the repository root:

```sh
npm install
npm start
```

Open `http://localhost:4173`. In Codespaces, run `npm run codespaces` and use the forwarded HTTPS URL.

Run tests without rebuilding the ignored avatar bundle:

```sh
node --test
```

Check source syntax without rewriting generated output:

```sh
node --check server.js
find desktop public scripts test -type f -name '*.js' ! -path 'public/avatar3d.bundle.js' -print0 | xargs -0 -n1 node --check
git diff --check
```

`npm test` and `npm run check` invoke the avatar bundle build hook; use them when rebuilding `public/avatar3d.bundle.js` is intended.

## Safety and disabled functionality

- Never commit `.env` files, API keys, access tokens, passwords, private keys, or other credentials. Configure provider secrets only in the trusted server/deployment environment.
- Keep imported extension packages and Code Studio text inert. Do not execute extension or editor content.
- AI Modify must not modify project files automatically. Any future write feature requires a separate security review, explicit approval, workspace path validation, backups, validation, and rollback design.
- Project write/backup/rollback controls are not enabled. Do not infer approval for those operations from this handoff.
- No general shell, desktop automation, or unrestricted filesystem access is exposed to the browser or Electron renderer.
- Preserve the existing repository history and do not force-push or change the default branch for this backup.
