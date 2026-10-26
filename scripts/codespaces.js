import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function getForwardedUrl({ codespaceName, forwardingDomain, port = 4173 }) {
  if (!codespaceName) return null;
  const domain = (forwardingDomain || 'app.github.dev').replace(/^https?:\/\//, '').replace(/\/$/, '');
  return `https://${codespaceName}-${port}.${domain}`;
}

export function getServerEnvironment(environment = process.env, args = []) {
  const port = String(environment.PORT || 4173);
  const useOllama = args.includes('--ollama') || environment.AI_PROVIDER === 'ollama';
  const serverEnvironment = { ...environment, PORT: port };
  if (useOllama) {
    serverEnvironment.AI_PROVIDER = 'ollama';
    serverEnvironment.OLLAMA_BASE_URL ||= 'http://127.0.0.1:11434';
    serverEnvironment.OLLAMA_MODEL ||= 'qwen2.5:3b';
  }
  return serverEnvironment;
}

export function startCodespacesServer(environment = process.env) {
  const serverEnvironment = getServerEnvironment(environment, process.argv.slice(2));
  const port = serverEnvironment.PORT;
  const forwardedUrl = getForwardedUrl({
    codespaceName: environment.CODESPACE_NAME,
    forwardingDomain: environment.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN,
    port,
  });
  const child = spawn(process.execPath, ['server.js'], {
    cwd: resolve(fileURLToPath(new URL('..', import.meta.url))),
    env: serverEnvironment,
    stdio: 'inherit',
  });

  child.once('spawn', () => {
    console.log(`J.A.R.V.I.S. is starting on port ${port}.`);
    if (forwardedUrl) {
      console.log(`Phone URL (private Codespaces port): ${forwardedUrl}`);
    } else {
      console.log('Open the Ports tab in VS Code and use the forwarded URL for port 4173.');
    }
  });
  child.once('error', (error) => {
    console.error(`Could not start J.A.R.V.I.S.: ${error.message}`);
    process.exitCode = 1;
  });

  const forwardSignal = (signal) => child.kill(signal);
  process.once('SIGINT', forwardSignal);
  process.once('SIGTERM', forwardSignal);
  child.once('exit', (code, signal) => {
    process.removeListener('SIGINT', forwardSignal);
    process.removeListener('SIGTERM', forwardSignal);
    process.exitCode = code ?? (signal ? 1 : 0);
  });

  return child;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  startCodespacesServer();
}