# J.A.R.V.I.S. Personal Assistant

A cross-platform assistant with a responsive holographic interface, local conversation history, browser-native speech, source-linked web lookup, and optional local or hosted AI. The existing Node-served web app can be used in a browser or installed as a PWA, and an optional Electron shell can be packaged as a Windows desktop installer.

The original conversation interface remains the default for new users. Use **New Interface** in the header to open the optional sci-fi dashboard, and **Old Interface** to return to the original conversation view. The selected interface is remembered in this browser. Both use the same chat, voice, provider settings, and backend. The dashboard has desktop status/chat/voice panels, a responsive mobile stack, and a six-action feature dock. CPU, RAM, and storage values are measurements from the app server/container, not necessarily the user's device; unavailable values are not estimated. The centered portrait is a locally bundled Unsplash photograph (image ID `photo-1534528741775-53994a69daeb`) under a neon-blue holographic frame. See the [Unsplash License](https://unsplash.com/license); attribution is appreciated. The photo overlay can use approximate word-boundary cues or, when explicitly enabled, live tab-audio amplitude. Neither provides phoneme-accurate lip sync. The optional local 3D renderer animates only controls present in the selected model; no model is bundled. If the photo fails to load, the holographic frame falls back to a text identity mark.

The same web app can be used in a browser, installed as a PWA, or run in the optional Windows desktop shell. The UI and server features are shared; browser history, preferences, and locally selected avatar files remain on each device and are not synchronized.

## Run locally

Requires Node.js 20 or newer. Install dependencies once:

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

To share from the Settings **Share JARVIS** section, use a public HTTPS address. For an existing Codespace, run `npm run codespaces`, set port `4173` visibility to **Public** in the VS Code **Ports** tab, then open the forwarded HTTPS address and use **Share Link** or **Copy Link**. Public visibility lets anyone with the URL reach the app while the Codespace is running. The server keeps AI provider configuration in shared server memory; configure `APP_ACCESS_TOKEN` before public exposure to prevent anonymous API access. Recipients then need that access key separately, so a link alone is not sufficient for them to use protected APIs. Never put access keys or provider keys in the shared link. The share link contains only the app origin, never API keys, access keys, chat history, or preferences. The app does not deploy itself or change port visibility.

### Install as a PWA

Open the app using its secure Codespaces HTTPS URL; installation is not available from an insecure LAN `http://` address. The app header's install button opens the browser's native prompt when available, or shows these browser-specific steps:

- **Android / Chrome:** tap the app's install button and accept Chrome's prompt. If there is no native prompt, open Chrome's three-dot menu and choose **Install app** or **Add to Home screen**.
- **Windows / Edge:** click the address-bar Apps/install icon, or choose **Settings and more > Apps > Install this site as an app**.
- **Windows / Chrome:** click the address-bar install icon, or choose **More > Cast, save, and share > Install page as app**.
- **iPhone / iPad:** open the HTTPS link in Safari, tap **Share**, then choose **Add to Home Screen**.

The PWA uses 192px/512px PNG icons plus an SVG icon. Its service worker prefers the current network app shell and uses its cache when offline. Chat and search still need the server and network. Actual install prompts vary by browser version and are not emulated by the app.

### Windows desktop installer

On a Windows PC with Node.js 20+ installed, from a project checkout run:

```sh
npm install
npm run desktop:dist
```

The NSIS installer is written to `dist-desktop/`. To run the desktop shell without packaging it, use `npm run desktop`. The shell starts the existing server on a random loopback-only port and loads the same app; the website is not publicly exposed by the desktop app. Protect any hosted server separately with `APP_ACCESS_TOKEN`. The installer is unsigned, so Windows SmartScreen may show a warning. A Windows installer is built on Windows; it is not produced by running the packaging command in a Codespace/Linux environment.

To inspect UI startup from a phone without DevTools, open the app URL with `?diagnostics=1`. The on-page panel reports JavaScript errors, dashboard visibility and size, the saved interface mode, and whether a service worker controls the page. Remove the query parameter to hide the panel.

## Configure AI

Without a provider, chat responds with a clear unavailable message. Open **Settings → AI provider** to configure either supported provider and model:

- **OpenAI-compatible API:** the form defaults to Google Gemini's `gemini-2.5-flash` model and OpenAI-compatible base URL (`https://generativelanguage.googleapis.com/v1beta/openai/`); both are configurable. Enter a provider API key. The key is sent to the Node server, held only in server memory, and never returned to the browser or saved in browser storage. Use a trusted server over HTTPS. In production, configure `APP_ACCESS_TOKEN` before using this form.
- **Ollama (local):** enter a model already installed on the Node server's host. J.A.R.V.I.S. uses `OLLAMA_BASE_URL` or `http://127.0.0.1:11434`.

Settings made in the UI apply only until the Node server restarts. Use **Use server environment** to return to environment-based configuration.

For local Ollama, run Ollama on a host reachable from this Node server, install a model such as `qwen2.5:3b`, then set:

```sh
OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:3b npm start
```

In Codespaces, use `npm run codespaces:ollama` to select `qwen2.5:3b` with the default loopback endpoint without storing credentials. This starts J.A.R.V.I.S.; it does not install or start Ollama or download model weights. The Codespace must have Ollama running locally for chat to succeed.

The Ollama endpoint must be reachable from the Node process. For hosted deployment, `127.0.0.1` refers to the hosted server, not your phone or computer.

For a hosted OpenAI-compatible chat-completions provider, set credentials only in the server environment. With no model or base URL override, the server uses Gemini's `gemini-2.5-flash` model and Google endpoint:

```sh
AI_API_KEY=your-server-side-key AI_MODEL=gemini-2.5-flash npm start
```

Set `AI_BASE_URL` to use a different OpenAI-compatible provider. Never put provider keys in `public/`, browser storage, or a public repository. If the app will be reachable by others, set a long random `APP_ACCESS_TOKEN`; the UI accepts it in Settings and holds it only in memory until the tab closes.

## Capabilities and limits

- **Chat:** AI requests go through the Node server. Conversation context is sent to the selected provider when you chat. No provider is bundled, and model quality/language support depends on the provider/model you configure.
- **Voice:** Input uses the browser's `SpeechRecognition` implementation when present; output uses the operating system voices exposed by `speechSynthesis`. Browser support, Hindi voices, microphone permission, and whether recognition uses a network service vary by device. Voice output is off by default.
- **Avatar:** The bundled female portrait remains the fallback; repository search found no `.vrm`, `.glb`, or `.gltf` avatar asset. For a human-realistic female model, browse [Sketchfab's downloadable model search](https://sketchfab.com/search?features=downloadable&type=models&q=realistic%20female%20human%20face), filter to CC0 or CC Attribution (CC BY), and verify the selected model's exact license, required attribution, intended-use permissions, adult appearance, and facial rig before downloading. Download its glTF package, extract it, import `scene.gltf` in Blender with **File → Import → glTF 2.0**, confirm textures and mouth/blink/eye-look shape keys or bones, then export through **File → Export → glTF 2.0** as a self-contained `.glb` with embedded images; preserve attribution/license details. Alternatively provide a compatible VRM directly. Choose **Load local 3D avatar** and select a self-contained `.vrm` or `.glb` up to 20 MB. The file is parsed locally and is not uploaded or persisted; choose it again after reloading the app. A compatible VRM should expose mouth/blink expressions and eye-look controls; GLB needs supported facial morphs and eye/head bones for corresponding animation. Three.js frames the model as a portrait; blinking, expressions, eye gaze, subtle head motion, and idle movement depend on supported rig controls. The app does not download, bundle, or verify a model's appearance, quality, or license. Browser `speechSynthesis` does not expose its audio samples. The optional **Sync mouth to tab audio** button asks you to share the J.A.R.V.I.S. tab's audio through the browser; when available, local Web Audio analysis drives mouth opening from the actual captured amplitude while speech plays. Audio is not recorded or uploaded. This is amplitude-based, not phoneme-accurate; if tab audio cannot be shared, approximate speech word-boundary cues are used when the browser provides them.
- **System monitor:** Browser-reported device/platform, online status, voice support, and supported mobile battery or JavaScript-heap readings are labeled separately from CPU/RAM/storage metrics collected on the J.A.R.V.I.S. server/container. Microphone permission status is queried without requesting access. Browser support and privacy protections can make individual values unavailable; the page does not estimate missing readings.
- **Attachments:** Small text, Markdown, and CSV files are read in the browser (maximum 16 KB / 2,500 characters) and included with the next chat message. They are not uploaded or stored separately by this server, but are sent to the configured AI provider with the conversation.
- **Search:** Uses DuckDuckGo Instant Answers when available and falls back to the Wikimedia search API for source-linked English or Hindi Wikipedia articles. Wikipedia coverage is limited to its encyclopedia; results are retrieved facts with source links, not AI-generated explanations. If both providers fail, the app reports the network error rather than inventing results.
- **Memory:** Preferences and up to 80 conversation messages are stored in browser `localStorage`. This is device-local, not encrypted storage. Turn off history or clear it from the app's settings to remove it.
- **PWA:** The app shell can be installed and cached for offline viewing when served over HTTPS (or localhost). Chat and internet search require the server/network. The SVG icon and manifest are included; install prompts vary by browser.
- **Device control:** A browser/PWA cannot control the whole phone or desktop, read private files, or send messages. No such actions are implemented.
- **Full Access:** The OFF/ON setting controls only explicit, user-triggered in-app shortcuts (voice and web lookup). It does not grant autonomous computer/project access; there is no OS-control integration in this browser project.

## Deployment

Deploy the Node server and `public/` directory together on a Node 20+ host that provides HTTPS. Set AI credentials and `APP_ACCESS_TOKEN` as server-side environment variables in the host's secret manager. Do not publish until you have authorized the hosting account and configured access protection. A static-only host can show the cached UI but cannot provide this repository's chat/search APIs without a separate server implementation.