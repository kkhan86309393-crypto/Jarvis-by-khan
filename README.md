# J.A.R.V.I.S. Personal Assistant

A cross-platform assistant with a responsive holographic interface, local conversation history, browser-native speech, source-linked web lookup, and optional local or hosted AI. The existing Node-served web app can be used in a browser or installed as a PWA, and an optional Electron shell can be packaged as a Windows desktop installer.

The Three.js/VRM renderer is downloaded only when **Activate holographic avatar** or **Load local 3D model** is selected. The built-in, original procedural hologram uses no external model or paid service; custom VRM/GLB loading remains available. The default user-approved static avatar and speech cues do not load the 3D engine.

The original conversation interface remains the default for new users. Use **New Interface** in the header to open the optional sci-fi dashboard, and **Old Interface** to return to the original conversation view. The selected interface is remembered in this browser. Both use the same chat, voice, provider settings, and backend. The dashboard has desktop status/chat/voice panels, a responsive mobile stack, and a six-action feature dock. CPU, RAM, and storage values are measurements from the app server/container, not necessarily the user's device; unavailable values are not estimated. The dashboard displays the user-approved static avatar at `public/5234e417739a8221c0d6ce9c25d690ff69dd8de1860b0b9394bad1a30df599e4.png` inside its circular holographic frame; the old generic portrait is not used. **Activate holographic avatar** keeps the existing procedural bust and blue holographic environment, applying a 256×256 UV-mapped texture from the bundled `public/reference-face.jpg` to its oval 3D face. The existing gaze, head movement, and assistant expressions remain active. The optional mouth sync can use approximate word-boundary cues or, when explicitly enabled, live tab-audio amplitude. Neither provides phoneme-accurate lip sync.

The **JARVIS APP HUB** is available in both interfaces. It provides browser-local app shortcuts, search, editing, reordering, deletion, optional raster icon uploads, and a URL Runner. It accepts HTTP/HTTPS destinations, explicit Android `intent://` app links, `tel:` dialer links, and `sms:` message-draft links. Android app links require Full Access; dialer and message links are explicit user actions that ask the browser/OS to hand off, where the user reviews and confirms. In the Electron desktop shell, the Open action can request an HTTPS, dialer, or message link through a narrow, validated IPC bridge; Android `intent://` links remain unsupported there. The browser or operating system may block or fail to confirm a handoff. **Copy text** copies only the text currently entered in URL Runner after you click it. In Electron this uses a bounded, write-only clipboard IPC; in browsers it uses the browser clipboard API when available. J.A.R.V.I.S. does not read the clipboard, place calls, or send messages, and requests no call/SMS permissions. The app cannot detect arbitrary installed apps, execute APKs/native applications, run shell commands, or control the desktop generally. Shortcuts and uploaded icons remain in that browser's local storage.

**JARVIS Vision** uses the browser's explicit screen picker only after you choose Vision. It captures one frame locally, shows a preview, and sends that frame only after you enter a question and choose **Send to J.A.R.V.I.S.** The JPEG is limited to 1280 pixels on its longest side and 500 KB. Closing the dialog, disabling Full Access, or pressing **Emergency Stop** stops capture, cancels an active request, and clears the local preview. The feature does not capture in the background or automatically retry a Vision request.

The same web app can be used in a browser, installed as a PWA, or run in the optional Windows desktop shell. The UI and server features are shared; browser history, preferences, and locally selected avatar files remain on each device and are not synchronized.

## Run locally

Requires Node.js 22.12 or newer. Install dependencies once:

```sh
npm install
npm start
```

Open `http://localhost:4173`. To run the checks:

```sh
npm test
npm run check
```

### GitHub Codespaces and phone

In a Codespace, run:

```sh
npm run codespaces
```

Port `4173` is configured for automatic forwarding with **Private** visibility. The command prints the Codespaces HTTPS URL and starts the existing server; Codespaces may also open the forwarded URL in the browser. To use it on your phone, copy that HTTPS URL from the terminal or the VS Code **Ports** tab. The phone must be signed into an account authorized for this private Codespace. No public deployment or public port visibility is configured.

For a Gemini key that survives server restarts, add an account-level **Codespaces secret** named `AI_API_KEY` in GitHub Settings → Codespaces → Codespaces secrets, and grant this repository access. Do not put the key in project files, a terminal command, or the Settings form if it must persist. Stop and restart the Codespace after creating or changing the secret; `npm run codespaces` inherits it as an environment variable. `/api/health` then reports `providerSource: "environment"` and `aiConfigured: true` without returning the key. If it reports `"none"`, the secret is not available in this Codespace. The Settings form remains available for a temporary key held in server memory only.

To share from the Settings **Share JARVIS** section, use a public HTTPS address. For an existing Codespace, run `npm run codespaces`, set port `4173` visibility to **Public** in the VS Code **Ports** tab, then open the forwarded HTTPS address and use **Share Link** or **Copy Link**. Public visibility lets anyone with the URL reach the app while the Codespace is running. The server keeps AI provider configuration in shared server memory; configure `APP_ACCESS_TOKEN` before public exposure to prevent anonymous API access. Recipients then need that access key separately, so a link alone is not sufficient for them to use protected APIs. Never put access keys or provider keys in the shared link. The share link contains only the app origin, never API keys, access keys, chat history, or preferences. The app does not deploy itself or change port visibility.

### Persistent deployment on Render

Codespaces is a development environment, not persistent hosting. When a Codespace stops or sleeps, its Node server and forwarded URL stop serving the app; a service-worker cache can show the UI offline but cannot keep `/api/chat` or `/api/search` running. A public Codespaces URL is not a permanent production address.

The root `render.yaml` defines a Render Node web service on the paid **Starter** plan, with `/api/health` as its health check. Render's free web services spin down after inactivity and can take about a minute to wake, so the free plan does not meet the always-on requirement. To deploy:

1. Push the project to the Git branch you want to deploy, making sure required project assets are tracked.
2. In Render, create a **Blueprint** and connect this repository. Review the `jarvis-personal-assistant` service name; change it in `render.yaml` if that Render subdomain is already taken.
3. Enter `AI_API_KEY` when Render requests the unsynchronized secret. It is stored as a Render environment secret, not in this repository. For an existing Render service, set or rotate `AI_API_KEY` in **Dashboard → service → Environment** and deploy/restart the service for it to take effect. Render generates `APP_ACCESS_TOKEN`; keep it private and enter it in **Settings → Server access key** on each browser/device session that will use protected APIs. The app intentionally keeps that access key in memory, not browser storage.
4. Wait for the deployment and health check to pass, then use the service's HTTPS `onrender.com` address. Render keeps this address while the service exists. Automatic deployment from the connected branch keeps it updated when you push changes.

The Render address is different from the Codespaces-forwarded address; a stopped Codespace cannot redirect its old URL. To keep a human-friendly address across hosting changes, configure a domain you own and point its DNS to the active host. Render's paid plan avoids idle spin-down, but is still subject to the provider's operational availability and billing.

J.A.R.V.I.S. stores conversation history and preferences in each browser's local storage, not on the server. They survive reopening the PWA at the same origin, but browser data is not synchronized and changing from a Codespaces origin to Render creates a separate storage area. A key entered in the in-app provider form is temporary server-memory configuration and is lost on restart; the form cannot write deployment secrets. Use the hosting provider's secret/environment settings for persistence. The health endpoint reports only whether AI is configured and whether the source is the process environment or temporary session memory; it never returns the secret. The app does not need a persistent server disk for its current features.

### Install as a PWA

Open the app using its secure Codespaces or Render HTTPS URL; installation is not available from an insecure LAN `http://` address. The app header's install button opens the browser's native prompt when available, or shows these browser-specific steps:

- **Android / Chrome:** tap the app's install button and accept Chrome's prompt. If there is no native prompt, open Chrome's three-dot menu and choose **Install app** or **Add to Home screen**.
- **Windows / Edge:** click the address-bar Apps/install icon, or choose **Settings and more > Apps > Install this site as an app**.
- **Windows / Chrome:** click the address-bar install icon, or choose **More > Cast, save, and share > Install page as app**.
- **iPhone / iPad:** open the HTTPS link in Safari, tap **Share**, then choose **Add to Home Screen**.

The PWA uses 192px/512px PNG icons plus an SVG icon. Its service worker pre-caches the essential app shell, refreshes assets with a bounded network wait, and serves the cached interface when offline or when the host returns a server error. Chat, search, settings saves, and other API calls still need the hosted server and a network connection. Actual install prompts vary by browser version and are not emulated by the app.

### Windows desktop installer

On a Windows PC with Node.js 22.12+ installed, from a project checkout run:

```sh
npm install
npm run desktop:dist
```

The NSIS installer is written to `dist-desktop/`. To run the desktop shell without packaging it, use `npm run desktop`. The shell starts the existing server on a random loopback-only port and loads the same app; the website is not publicly exposed by the desktop app. Its sandboxed preload exposes only `openExternalUrl` and `copyText`, requires a current user gesture, and sends requests to main-process validators that check the main frame, local origin, allowed schemes, and payload size. Opening websites uses the OS default browser; clipboard access is write-only and only used for an explicit Copy Link or Copy Text action. Voice recognition is stopped when the desktop window loses focus; wake detection can resume when focus returns only if it remains enabled and microphone permission is not denied. The app does not configure background audio or locked-screen microphone capture. TTS playback may be paused or interrupted by the OS when minimized or unfocused and is not guaranteed to continue. The shell does not expose arbitrary shell commands, unrestricted Node.js APIs, or general filesystem access. Protect any hosted server separately with `APP_ACCESS_TOKEN`. The installer is unsigned, so Windows SmartScreen may show a warning. A Windows installer is built on Windows; it is not produced by running the packaging command in a Codespace/Linux environment.

Before distributing a desktop build, manually verify on the target OS: open a known HTTPS site and confirm it reaches the default browser; try an invalid scheme and confirm it is rejected; use test-only `tel:`/`sms:` destinations and cancel in the dialer/messaging app without placing a call or sending a message; copy non-sensitive text and paste it into a separate app; try blank/oversized text; and confirm OS handoff failures are reported. Also verify in the renderer that `require`, Node globals, and arbitrary IPC channels are unavailable. These desktop/OS checks have not been run in this development environment.

For background lifecycle testing on real devices, enable wake-word mode with microphone permission granted, then switch away, hide the browser/PWA, lock the screen, or minimize Electron. Confirm recognition stops while hidden/unfocused; manual listening stays stopped after returning; wake listening resumes only after return to a visible, focused app while the setting remains enabled and permission is not denied; and denial turns wake mode off without repeated prompts. Minimize/restore should preserve the open Electron window's page state, but it does not provide background or locked-screen microphone/audio service. Locked-screen recognition is not guaranteed. These Android and desktop lifecycle checks have not been performed here.

To inspect UI startup from a phone without DevTools, open the app URL with `?diagnostics=1`. The on-page panel reports JavaScript errors, dashboard visibility and size, the saved interface mode, and whether a service worker controls the page. Remove the query parameter to hide the panel.

## Configure AI

Without a provider, chat responds with HTTP 503 and a clear configuration message. Check `/api/health` to see whether a provider is configured; Ollama reachability and model installation are checked there, while OpenAI-compatible connectivity is confirmed by an actual chat request. Open **Settings → AI provider** to configure either supported provider and model:

- **OpenAI-compatible API:** the form defaults to Google's documented Gemini `gemini-3.5-flash-lite` model and OpenAI-compatible base URL (`https://generativelanguage.googleapis.com/v1beta/openai/`); both are configurable. Enter a provider API key. The key is sent to the Node server, held only in server memory, and never returned to the browser or saved in browser storage. Use a trusted server over HTTPS. In production, configure `APP_ACCESS_TOKEN` before using this form.
- **Ollama (local):** enter a model already installed on the Node server's host. J.A.R.V.I.S. uses `OLLAMA_BASE_URL` or `http://127.0.0.1:11434`.

When both `AI_API_KEY` and `OLLAMA_BASE_URL` are set, the API key takes precedence unless `AI_PROVIDER=ollama` explicitly selects Ollama.

Settings made in the UI apply only until the Node server restarts. Use **Use server environment** to return to environment-based configuration.

OpenAI-compatible chat requests have a 45-second provider timeout and make at most two short exponential-backoff retries for transient HTTP 5xx responses. Gemini requests use low reasoning effort to reduce response latency. Timeouts and connection failures are reported without retrying, so a slow request is not multiplied into several long waits.

For local Ollama, run Ollama on a host reachable from this Node server, install a model such as `qwen2.5:3b`, then set:

```sh
OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:3b npm start
```

In Codespaces, use `npm run codespaces:ollama` to select `qwen2.5:3b` with the default loopback endpoint without storing credentials. This starts J.A.R.V.I.S.; it does not install or start Ollama or download model weights. The Codespace must have Ollama running locally for chat to succeed.

The Ollama endpoint must be reachable from the Node process. For hosted deployment, `127.0.0.1` refers to the hosted server, not your phone or computer.

For a hosted OpenAI-compatible chat-completions provider, set credentials only in the server environment. With no model or base URL override, the server uses Gemini's `gemini-3.5-flash-lite` model and Google endpoint:

```sh
AI_API_KEY=your-server-side-key AI_MODEL=gemini-3.5-flash-lite npm start
```

Set `AI_BASE_URL` to use a different OpenAI-compatible provider. Never put provider keys in `public/`, browser storage, or a public repository. If the app will be reachable by others, set a long random `APP_ACCESS_TOKEN`; the UI accepts it in Settings and holds it only in memory until the tab closes.

## Capabilities and limits

- **Desktop browsers:** Compatibility is capability-based, not a certified browser/version matrix. The web UI relies on modern JavaScript modules, Fetch, local storage, and native HTML dialogs. Voice requires a browser-provided `SpeechRecognition` or `webkitSpeechRecognition` implementation and microphone permission; external links depend on user-gesture, popup, and operating-system policies. Browser identification in the system panel is informational, not a guarantee of feature support. No browser/version matrix or physical desktop compatibility run is claimed.
- **Desktop actions:** The Electron shell's preload exposes only validated external-link requests and bounded clipboard writes. App Hub opens allowlisted HTTPS, `tel:`, and `sms:` destinations through the operating system; Android `intent://` links are not supported in the desktop shell. Copy Text acts only on text the user entered and clicked to copy. J.A.R.V.I.S. has no general desktop automation, shell execution, arbitrary file access, keyboard monitoring, or computer-control API.
- **Chat:** AI requests go through the Node server. Conversation context is sent to the selected provider when you chat. No provider is bundled, and model quality/language support depends on the provider/model you configure.
- **Voice:** Input uses the browser's standard `SpeechRecognition` API or its `webkitSpeechRecognition` variant when present; output uses the operating system voices exposed by `speechSynthesis`. Android browsers that expose the Web Speech API use the same voice controls; microphone permission prompts and permission-status reporting vary by browser. Hindi input requests `hi-IN`, English input requests `en-US`; actual recognition and available system voices depend on the browser/device and selected language. Voice output is on by default when the browser supports speech synthesis; a saved preference can turn it off. **Wake-word detection** is an explicit, browser-local opt-in in Settings for **"Hey JARVIS"** or **"हे जार्विस"**. It is not system-wide or available when the app is closed or the screen is locked. Recognition pauses on page hide or window blur; opted-in wake detection resumes only after the page is visible/focused and permission is not known denied. A microphone denial turns wake mode off; after granting access in system settings, enable it again manually. Browsers and operating systems may still suspend recognition while backgrounded or sleeping, so continuous wake detection is not guaranteed. Speech synthesis may pause or stop in the background according to the browser/OS; the app does not provide a locked-screen audio service. Wake phrase transcription depends on the selected conversation language and the browser/device speech service, so support for both phrases is not guaranteed on every device. Voice requires a secure context (HTTPS or localhost) and microphone permission. Recognition may send audio to a browser-provided speech service depending on the browser and device.
- **Avatar:** The built-in hologram uses the existing lazy-loaded Three.js runtime and a bundled 256×256 reference-photo face texture; no model download, API, or paid service is required. Its face is mapped onto a lightweight procedural head, not reconstructed as a fully photorealistic 3D model. **Load local 3D model** accepts a self-contained `.vrm` or `.glb` up to 20 MB. The file is parsed locally and is not uploaded or persisted; choose it again after reloading the app. A compatible VRM should expose mouth/blink expressions and eye-look controls; GLB needs supported facial morphs and eye/head bones for corresponding animation. For a more realistic custom model, browse [Sketchfab's downloadable model search](https://sketchfab.com/search?features=downloadable&type=models&q=realistic%20female%20human%20face), verify the exact license and facial rig, then use Blender to export a self-contained GLB with embedded images. The app does not download, bundle, or verify a custom model's appearance, quality, or license. Browser `speechSynthesis` does not expose its audio samples. The optional **Sync mouth to tab audio** button asks you to share the J.A.R.V.I.S. tab's audio through the browser; when available, local Web Audio analysis drives mouth opening from the actual captured amplitude while speech plays. Audio is not recorded or uploaded. This is amplitude-based, not phoneme-accurate; if tab audio cannot be shared, approximate speech word-boundary cues are used when the browser provides them.
- **System monitor:** Browser-reported device/platform, online status, voice support, and supported mobile battery or JavaScript-heap readings are labeled separately from CPU/RAM/storage metrics collected on the J.A.R.V.I.S. server/container. Microphone permission status is queried without requesting access. Browser support and privacy protections can make individual values unavailable; the page does not estimate missing readings.
- **Attachments:** Small text, Markdown, and CSV files are read in the browser (maximum 16 KB / 2,500 characters) and included with the next chat message. They are not uploaded or stored separately by this server, but are sent to the configured AI provider with the conversation.
- **Search:** Uses DuckDuckGo Instant Answers when available and falls back to the Wikimedia search API for source-linked English or Hindi Wikipedia articles. Results remain unmodified and linked; choose **Summarize with AI** on an individual result set to request one concise, source-grounded summary. No summary request is made automatically. If no AI provider is configured, search still works and the app explains that summaries are unavailable. If both search providers fail, the app reports the network error rather than inventing results.
- **Memory:** Preferences and up to 80 conversation messages are stored in browser `localStorage`. This is device-local, not encrypted storage. Turn off history or clear it from the app's settings to remove it.
- **PWA:** The app shell can be installed and cached for offline viewing when served over HTTPS (or localhost). Chat and internet search require the server/network. The SVG icon and manifest are included; install prompts vary by browser.
- **Device control:** A browser/PWA cannot control the whole phone or desktop, read private files, or send messages. No such actions are implemented.
- **Full Access:** The OFF/ON setting controls explicit in-app actions, Vision capture, and Android intent launches. Disabling it closes Vision and cancels/clears an active capture. It does not grant autonomous computer/project access; there is no OS automation or general OS-control integration in this browser project.

## Deployment

Deploy the Node server and `public/` directory together on a Node 22.12+ host that provides HTTPS. Set AI credentials and `APP_ACCESS_TOKEN` as server-side environment variables in the host's secret manager. Do not publish until you have authorized the hosting account and configured access protection. A static-only host can show the cached UI but cannot provide this repository's chat/search APIs without a separate server implementation.