# PROJECT_HANDOFF.md

## Project

- **Name:** J.A.R.V.I.S.
- **Repository:** `kkhan86309393-crypto/Jarvis-by-khan`
- **Primary branch:** `main`
- **Runtime:** Node.js server with vanilla HTML, CSS and JavaScript; optional Electron wrapper; Playwright browser tests.

## Architecture

- `server.js` serves the app and API.
- `public/index.html` contains the dashboard, hero, navigation, dialogs and technical cards.
- `public/styles.css` contains desktop/mobile layout and hologram presentation.
- `public/app.js` controls application state, navigation, voice/chat routing and WebGL activation.
- `public/avatar3d.js` and `public/avatar3d.bundle.js` contain the Three.js holographic avatar/Earth implementation.
- `public/portrait-animation.js`, `public/avatar-cues.js` and `public/mobile-home.js` contain blink, lip-sync, gaze, assistant-state and mobile waveform behavior.
- `public/jarvis-portrait.webp` is the Home portrait asset.
- `public/reference-face.jpg` remains the avatar/animation texture source; it must not be replaced by the Home cutout.
- `public/service-worker.js` provides offline application caching.
- `desktop/` contains the Electron desktop integration.
- `test/` contains Node.js regression tests.
- `browser-tests/` contains Playwright browser coverage.

## Completed work

1. Existing portrait cutout and normalized face overlays were integrated.
2. Mobile navigation, dashboard cards and voice/chat flows were restored.
3. Scrollable single-column mobile layout and safe fixed input/nav positioning were restored.
4. Holographic portrait/Earth stage, rings, platform, beam and waveform were implemented and refined.
5. Local commits, cache updates and mobile Playwright verification were added.

## Mobile restoration requirements

Technical cards, including Real-Time Info, Server RAM, Server Storage, Quick Actions, News, uploads, App Hub, AI status and Activity, must remain available in their existing sections. Home, Chat, Voice, Apps, More, LAB and all other navigation options must remain functional. Mobile vertical scrolling must never be locked by `overflow: hidden`, `height: 100dvh`, or fixed dashboard containers. Only the upper AI hero should be visually refined.

## Reference visual target

- Use the existing reference portrait asset only; never generate or substitute a new AI face.
- Portrait: centered, large and anatomically clear.
- Earth: bright cyan-blue holographic globe behind the portrait, with atmosphere, visible latitude/longitude grid, continents, orbital rings and particles.
- Platform: thin concentric holographic rings below the portrait.
- Beam: clearly rising through the lower center of the Earth.
- Status row: Listening, Thinking, Speaking and Online with larger circular icons and readable labels.
- Waveform and microphone input: compact and usable above the fixed bottom navigation.
- Avoid hero overflow, page clipping, horizontal scrolling, and overlapping fixed controls.

## Feature status

- Working: navigation, Home dashboard, chat, voice entry, applications, More, Lab, cards, technical monitoring, scrolling, fixed input bar, portrait cutout, overlays, service worker, desktop shell.
- Visual polish in progress: reference-faithful Earth brightness/grid/continents, exact portrait proportions, platform/beam prominence and status row sizing should be checked in real screenshots at 360x780, 390x844 and 430x932.

## Release state

- Service worker cache: `jarvis-shell-v87`
- Final audit baseline restored: `087c0b4`
- Automated Node regression suite: 275 tests passing
- Avatar build and repository syntax checks: passing
- Runtime layout smoke checks: 360x780, 390x844, 430x932 and 1440x1000 all have no horizontal overflow; mobile page height remains scrollable
- Playwright screenshot capture: headless Chromium renderer crashes in this environment with and without the avatar WebGL bundle, so screenshot/video verification remains incomplete for hardware-independent automation
- Run `npm test`, `npm run build`, and `git diff --check` before pushing or deploying further changes.

## Next collaborator instructions

1. Open this repository in VS Code or Codespaces.
2. Run `npm install` only if dependencies are missing; `node_modules` is intentionally excluded.
3. Run `npm start` and open the forwarded port 4173.
4. Create a feature branch for each visual task.
5. Preserve `public/reference-face.jpg`, all voice/chat functionality, every dashboard card, every bottom-navigation option, and existing vertical scrolling.
6. For mobile visual work, test 360x780, 390x844 and 430x932 with Playwright. Compare real screenshots; passing CSS tests alone is not sufficient.
7. Run tests, build and diff validation before every commit.
8. To add a collaborator with another GitHub identity, the repository owner must open GitHub repository settings, choose Collaborators, enter the collaborator GitHub username, and accept/approve the invitation themselves. Do not invite or change repository ownership without explicit owner approval. Clone setup:
   `git clone https://github.com/kkhan86309393-crypto/Jarvis-by-khan.git`, then run `cd Jarvis-by-khan && npm install && npm start`.

## Non-negotiable guardrails

Never delete or permanently hide Home, Chat, Voice, Apps, More, Lab, Server RAM, Storage, Real-Time Info, technical cards, news, files or other existing navigation/features. Never lock vertical scrolling. Work only on the upper AI hero when resolving visual reference-composition issues.
