const diagnosticsPanel = document.querySelector('#runtime-diagnostics');
const diagnosticsOutput = document.querySelector('#runtime-diagnostics-output');
const diagnosticsEnabled = new URLSearchParams(location.search).get('diagnostics') === '1';

if (diagnosticsEnabled && diagnosticsPanel && diagnosticsOutput) {
  const runtimeErrors = [];
  let appReady = false;

  function recordError(message) {
    runtimeErrors.push(message);
    if (runtimeErrors.length > 5) runtimeErrors.shift();
    renderDiagnostics();
  }

  function renderDiagnostics() {
    const dashboard = document.querySelector('#dashboard-layout');
    const style = dashboard ? getComputedStyle(dashboard) : null;
    const bounds = dashboard?.getBoundingClientRect();
    const lines = [
      `App startup: ${appReady ? 'ready' : 'not completed'}`,
      `Dashboard: ${dashboard ? 'found' : 'missing'}`,
      dashboard && style
        ? `Visible: hidden=${dashboard.hidden}, display=${style.display}, visibility=${style.visibility}, opacity=${style.opacity}`
        : 'Visible: unavailable',
      bounds ? `Size: ${Math.round(bounds.width)} × ${Math.round(bounds.height)} px` : 'Size: unavailable',
      `Active interface: ${dashboard && !dashboard.hidden ? 'new' : 'old'}`,
      `Service worker: ${navigator.serviceWorker?.controller ? 'controlling page' : 'not controlling page'}`,
      `JavaScript errors: ${runtimeErrors.length ? runtimeErrors.join(' | ') : 'none captured'}`,
    ];
    diagnosticsOutput.textContent = lines.join('\n');
  }

  window.addEventListener('error', (event) => {
    recordError(`${event.message || 'Script error'}${event.filename ? ` (${event.filename}:${event.lineno})` : ''}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    recordError(`Unhandled promise rejection: ${reason?.message || String(reason)}`);
  });
  window.addEventListener('jarvis:app-ready', () => {
    appReady = true;
    renderDiagnostics();
  });
  navigator.serviceWorker?.addEventListener('controllerchange', renderDiagnostics);
  document.querySelector('#close-runtime-diagnostics')?.addEventListener('click', () => {
    diagnosticsPanel.hidden = true;
  });

  diagnosticsPanel.hidden = false;
  renderDiagnostics();
  window.setInterval(renderDiagnostics, 1_000);
}
