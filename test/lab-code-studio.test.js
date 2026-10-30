import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  CODE_STUDIO_LANGUAGES,
  MAX_CODE_FILE_BYTES,
  createCodeExport,
  inferCodeLanguage,
  reviewCodeLocally,
  validateCodeFile,
} from '../public/lab-code-studio.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

test('supports language selection and performs static, non-executing review', () => {
  assert.deepEqual(CODE_STUDIO_LANGUAGES.map(({ id }) => id), [
    'javascript', 'typescript', 'python', 'html', 'css', 'json', 'markdown', 'text',
  ]);
  assert.equal(inferCodeLanguage('example.TSX'), 'typescript');
  assert.equal(inferCodeLanguage('README.md'), 'markdown');

  const findings = reviewCodeLocally([
    'const API_KEY = "sk-private-example-value";',
    'eval(input);',
    'target.innerHTML = content;',
  ].join('\n'));

  assert.deepEqual(findings.map(({ line, severity }) => ({ line, severity })), [
    { line: 1, severity: 'warning' },
    { line: 2, severity: 'warning' },
    { line: 3, severity: 'suggestion' },
  ]);
  assert.equal(JSON.stringify(findings).includes('sk-private-example-value'), false);
});

test('validates local text import types and size without executing or persisting content', () => {
  const file = (name, size, text = async () => 'untrusted text') => ({ name, size, text });
  assert.deepEqual(validateCodeFile(file('script.js', 20)), { valid: true, language: 'javascript' });
  assert.deepEqual(validateCodeFile(file('page.htm', 20)), { valid: true, language: 'html' });
  assert.equal(validateCodeFile(file('archive.zip', 20)).valid, false);
  assert.equal(validateCodeFile(file('large.py', MAX_CODE_FILE_BYTES + 1)).valid, false);
  assert.equal(validateCodeFile({ name: 'no-reader.js', size: 2 }).valid, false);
  assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)\([^)]*code.?studio/i);
});

test('exports a separate plain-text download with a language-based filename', async () => {
  const code = '<script>alert("untrusted")</script>';
  const exported = createCodeExport(code, 'html');

  assert.equal(exported.fileName, 'jarvis-code-studio.html');
  assert.equal(exported.blob.type, 'text/plain;charset=utf-8');
  assert.equal(await exported.blob.text(), code);
  assert.match(app, /window\.confirm\('Export a separate text copy/);
  assert.match(app, /window\.confirm\('Import a local code or text file/);
});

test('redacts credential-like values from copied and exported text without changing the editor', async () => {
  const code = 'const API_KEY = "sk-private-example-value-123456";';
  const exported = createCodeExport(code, 'javascript');

  assert.equal(await exported.blob.text(), 'const API_KEY = "[REDACTED]";');
  assert.match(app, /copyTextToClipboard\(safeText\)/);
  assert.match(app, /createCodeExport\(code, elements\.codeStudioLanguage\.value\)/);
  assert.match(app, /downloaded with credential-like values redacted/);
  assert.match(app, /elements\.codeStudioEditor\.value = redactSensitiveText\(codeStudioPreviewSource\)/);
  assert.match(app, /switch it off to edit the original local text/);
});

test('keeps Code Studio isolated, read-only capable, and project-file safe', () => {
  const moduleCard = html.match(/<article class="lab-module-card lab-module-action" data-lab-module="code-studio"[\s\S]*?<\/article>/)?.[0] || '';
  const panel = html.match(/<section class="code-studio-panel"[\s\S]*?<\/section>\s*<p class="lab-disclaimer"/)?.[0] || '';

  assert.match(moduleCard, /aria-controls="code-studio-panel"/);
  assert.match(panel, /id="code-studio-language"/);
  assert.match(panel, /id="code-studio-editor"[^>]*spellcheck="false"/);
  assert.match(panel, /id="code-studio-readonly"/);
  assert.match(panel, /id="code-studio-review"/);
  assert.match(panel, /id="code-studio-findings"/);
  assert.match(panel, /id="code-studio-copy"/);
  assert.match(panel, /id="code-studio-clear"/);
  assert.match(panel, /id="code-studio-file" type="file"/);
  assert.match(panel, /id="code-studio-export"/);
  assert.match(panel, /never executed/);
  assert.match(panel, /Syntax highlighting unavailable/);
  assert.match(app, /querySelector\('\[data-lab-module="code-studio"\]'\)\.addEventListener\('click', openCodeStudioPanel\)/);
  assert.match(app, /elements\.codeStudioEditor\.readOnly = readOnly/);
  assert.match(app, /const text = await file\.text\(\)/);
  assert.match(app, /There is no code to export/);
  assert.doesNotMatch(app.slice(app.indexOf('function openCodeStudioPanel'), app.indexOf('function updateCodeStudioReview')), /\/api\/chat|fetch\(|eval\(|writeFile|exec\(/);
  const importHandler = app.slice(app.indexOf('function prepareCodeStudioImport'), app.indexOf('function resetPersonalizeDraft'));
  assert.ok(importHandler.indexOf('window.confirm(') < importHandler.indexOf('elements.codeStudioFile.click()'));
  const exportHandler = app.slice(app.indexOf('function exportCodeStudioText'), app.indexOf('function clearCodeStudioText'));
  assert.ok(exportHandler.indexOf('window.confirm(') < exportHandler.indexOf('URL.createObjectURL(blob)'));
  assert.match(app, /elements\.codeStudioEditor\.value = elements\.codeStudioReadonly\.checked \? redactSensitiveText\(text\) : text/);
  assert.doesNotMatch(app.slice(app.indexOf('function updateCodeStudioReview'), app.indexOf('function updateCodeStudioEditorState')), /innerHTML|insertAdjacentHTML/);
});
