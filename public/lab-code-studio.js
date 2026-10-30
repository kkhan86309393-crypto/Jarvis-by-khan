import { redactSensitiveText } from './lab-safety.js';

export const MAX_CODE_FILE_BYTES = 1_000_000;

export const CODE_STUDIO_LANGUAGES = Object.freeze([
  { id: 'javascript', label: 'JavaScript', extension: 'js' },
  { id: 'typescript', label: 'TypeScript', extension: 'ts' },
  { id: 'python', label: 'Python', extension: 'py' },
  { id: 'html', label: 'HTML', extension: 'html' },
  { id: 'css', label: 'CSS', extension: 'css' },
  { id: 'json', label: 'JSON', extension: 'json' },
  { id: 'markdown', label: 'Markdown', extension: 'md' },
  { id: 'text', label: 'Plain text', extension: 'txt' },
]);

const LANGUAGE_BY_EXTENSION = new Map(
  CODE_STUDIO_LANGUAGES.map(({ id, extension }) => [extension, id]),
);
for (const extension of ['mjs', 'cjs', 'jsx']) LANGUAGE_BY_EXTENSION.set(extension, 'javascript');
for (const extension of ['tsx']) LANGUAGE_BY_EXTENSION.set(extension, 'typescript');
LANGUAGE_BY_EXTENSION.set('htm', 'html');

const REVIEW_RULES = [
  {
    pattern: /\b(?:api[_-]?key|secret|password|token)\b\s*[:=]\s*["'`][^"'`]{6,}["'`]/i,
    title: 'Possible secret-like value. Keep credentials out of code shared with others.',
    severity: 'warning',
  },
  {
    pattern: /\beval\s*\(/,
    title: 'Dynamic eval detected. Avoid executing generated or untrusted strings.',
    severity: 'warning',
  },
  {
    pattern: /\bnew\s+Function\s*\(/,
    title: 'Dynamic Function construction detected; it can execute arbitrary code.',
    severity: 'warning',
  },
  {
    pattern: /\binnerHTML\s*=/,
    title: 'Direct innerHTML assignment detected. Consider a text-safe DOM API.',
    severity: 'suggestion',
  },
];

export function inferCodeLanguage(fileName) {
  const extension = String(fileName).toLowerCase().split('.').pop();
  return LANGUAGE_BY_EXTENSION.get(extension) || 'text';
}

export function getCodeFileExtension(fileName) {
  const name = String(fileName).toLowerCase();
  const separator = name.lastIndexOf('.');
  return separator > 0 ? name.slice(separator + 1) : '';
}

export function validateCodeFile(file) {
  if (!file || typeof file.name !== 'string') {
    return { valid: false, reason: 'Choose a local code or text file.' };
  }
  const extension = getCodeFileExtension(file.name);
  if (!LANGUAGE_BY_EXTENSION.has(extension)) {
    return { valid: false, reason: 'Unsupported file type. Choose a recognized code or text file.' };
  }
  if (!Number.isFinite(file.size) || file.size < 0 || file.size > MAX_CODE_FILE_BYTES) {
    return { valid: false, reason: `File is too large. The limit is ${MAX_CODE_FILE_BYTES / 1_000_000} MB.` };
  }
  if (typeof file.text !== 'function') {
    return { valid: false, reason: 'This browser cannot read the selected file as text.' };
  }
  return { valid: true, language: inferCodeLanguage(file.name) };
}

export function reviewCodeLocally(code) {
  const lines = String(code).split(/\r?\n/);
  const findings = [];
  for (const [index, line] of lines.entries()) {
    for (const rule of REVIEW_RULES) {
      if (!rule.pattern.test(line)) continue;
      findings.push({
        line: index + 1,
        severity: rule.severity,
        title: rule.title,
      });
    }
  }
  return findings.slice(0, 25);
}

export function createCodeExport(code, language) {
  const selected = CODE_STUDIO_LANGUAGES.find((item) => item.id === language) || CODE_STUDIO_LANGUAGES.at(-1);
  const blob = new Blob([redactSensitiveText(code)], { type: 'text/plain;charset=utf-8' });
  return {
    blob,
    fileName: `jarvis-code-studio.${selected.extension}`,
  };
}
