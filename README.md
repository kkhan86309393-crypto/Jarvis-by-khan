# J.A.R.V.I.S. Personal Assistant

A browser-based assistant with a responsive holographic interface, local conversation history, browser-native speech, source-linked web lookup, and optional local or hosted AI. The repository began as an empty README; this implementation is a Node-served web app, not an Electron application.

The dashboard includes desktop navigation, a phone-specific compact layout, live browser/network capability indicators, a session activity log, source-linked instant-answer briefing, text-file attachments, and a switch back to the classic chat layout. The centered portrait is a locally bundled Unsplash photograph (image ID `photo-1534528741775-53994a69daeb`) under a neon-blue holographic frame. See the [Unsplash License](https://unsplash.com/license); attribution is appreciated. It is a still image, so it cannot naturally blink or provide phoneme-accurate lip synchronization. The original reference screenshot was not available in the repository for direct comparison.

## Run locally

Requires Node.js 20 or newer; no package installation is needed.

```sh
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

### Install as a PWA

Open the app using its secure Codespaces HTTPS URL; installation is not available from an insecure LAN `http://` address. The app header's install button opens the browser's native prompt when available, or shows these browser-specific steps:

- **Android / Chrome:** tap the app's install button and accept Chrome's prompt. If there is no native prompt, open Chrome's three-dot menu and choose **Install app** or **Add to Home screen**.
- **Windows / Edge:** click the address-bar Apps/install icon, or choose **Settings and more > Apps > Install this site as an app**.
- **Windows / Chrome:** click the address-bar install icon, or choose **More > Cast, save, and share > Install page as app**.

The PWA uses 192px/512px PNG icons plus an SVG icon, and its service worker caches the app shell. Chat and search still need the server and network. Actual install prompts vary by browser version and are not emulated by the app.

## Configure AI

Without a provider, chat responds with a clear unavailable message. Search, settings, and saved history remain available.

For local Ollama, run Ollama on a host reachable from this Node server, install a model such as `qwen2.5:3b`, then set:

```sh
OLLAMA_BASE_URL=http://127.0.0.1:11434 OLLAMA_MODEL=qwen2.5:3b npm start
```

In Codespaces, use `npm run codespaces:ollama` to select `qwen2.5:3b` with the default loopback endpoint without storing credentials. This starts J.A.R.V.I.S.; it does not install or start Ollama or download model weights. The Codespace must have Ollama running locally for chat to succeed.

The Ollama endpoint must be reachable from the Node process. For hosted deployment, `127.0.0.1` refers to the hosted server, not your phone or computer.

For a hosted OpenAI-compatible chat-completions provider, set credentials only in the server environment:

```sh
AI_API_KEY=your-server-side-key AI_MODEL=your-model npm start
```

Optional `AI_BASE_URL` changes the provider base URL (default: `https://api.openai.com/v1`). Never put provider keys in `public/`, browser storage, or a public repository. If the app will be reachable by others, set a long random `APP_ACCESS_TOKEN`; the UI accepts it in Settings and holds it only in memory until the tab closes.

## Capabilities and limits

- **Chat:** AI requests go through the Node server. Conversation context is sent to the selected provider when you chat. No provider is bundled, and model quality/language support depends on the provider/model you configure.
- **Voice:** Input uses the browser's `SpeechRecognition` implementation when present; output uses the operating system voices exposed by `speechSynthesis`. Browser support, Hindi voices, microphone permission, and whether recognition uses a network service vary by device. Voice output is off by default.
- **Avatar:** The photo remains still; a neon voice pulse follows supported speech-boundary events with a lightweight fallback pulse while speech is playing. It does not animate facial expressions or provide precise facial/phoneme synchronization.
- **Attachments:** Small text, Markdown, and CSV files are read in the browser (maximum 16 KB / 2,500 characters) and included with the next chat message. They are not uploaded or stored separately by this server, but are sent to the configured AI provider with the conversation.
- **Search:** Uses DuckDuckGo Instant Answer, returning only actual abstracts/related topics and their source URLs. It is not comprehensive web search; empty results are reported as empty rather than invented.
- **Memory:** Preferences and up to 80 conversation messages are stored in browser `localStorage`. This is device-local, not encrypted storage. Turn off history or clear it from the app's settings to remove it.
- **PWA:** The app shell can be installed and cached for offline viewing when served over HTTPS (or localhost). Chat and internet search require the server/network. The SVG icon and manifest are included; install prompts vary by browser.
- **Device control:** A browser/PWA cannot control the whole phone or desktop, read private files, or send messages. No such actions are implemented.
- **Full Access:** The OFF/ON setting controls only explicit, user-triggered in-app shortcuts (voice and web lookup). It does not grant autonomous computer/project access; there is no OS-control integration in this browser project.

## Deployment

Deploy the Node server and `public/` directory together on a Node 20+ host that provides HTTPS. Set AI credentials and `APP_ACCESS_TOKEN` as server-side environment variables in the host's secret manager. Do not publish until you have authorized the hosting account and configured access protection. A static-only host can show the cached UI but cannot provide this repository's chat/search APIs without a separate server implementation.