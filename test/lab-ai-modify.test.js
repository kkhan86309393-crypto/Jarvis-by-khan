import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  LAB_AI_MODIFY_HISTORY_KEY,
  LAB_AI_MODIFY_HISTORY_LIMIT,
  getLabAiModifyRequestStatus,
  loadLabAiModifyHistory,
  recordLabAiModifyHistory,
} from '../public/lab-ai-modify.js';

const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
  };
}

test('reports integration unavailable instead of claiming a plan was generated', () => {
  assert.equal(getLabAiModifyRequestStatus('Add a new dashboard widget'), 'unavailable');
  assert.equal(getLabAiModifyRequestStatus('   '), 'empty');
});

test('keeps bounded local history metadata without persisting user request text', () => {
  const storage = createStorage();
  const privatePrompt = 'Replace the API key with sk-example-secret-value';
  const recorded = recordLabAiModifyHistory(storage, getLabAiModifyRequestStatus(privatePrompt), 1234);

  assert.deepEqual(recorded, [{
    timestamp: 1234,
    status: 'unavailable',
    message: 'Plan not generated · AI Modify integration unavailable',
  }]);
  assert.equal(storage.values.get(LAB_AI_MODIFY_HISTORY_KEY).includes(privatePrompt), false);
  assert.deepEqual(loadLabAiModifyHistory(storage), recorded);

  for (let timestamp = 0; timestamp < LAB_AI_MODIFY_HISTORY_LIMIT + 3; timestamp += 1) {
    recordLabAiModifyHistory(storage, 'cancelled', timestamp);
  }
  assert.equal(loadLabAiModifyHistory(storage).length, LAB_AI_MODIFY_HISTORY_LIMIT);
});

test('shows review and approval controls while keeping file changes and code execution disabled', () => {
  const panel = html.match(/<section class="ai-modify-panel"[\s\S]*?<\/section>\s*<p class="lab-disclaimer"/)?.[0] || '';

  assert.match(panel, /textarea[^>]*id="ai-modify-request"/);
  assert.match(panel, /id="ai-modify-analyze" type="button"/);
  assert.doesNotMatch(panel, /<form[^>]*ai-modify/);
  assert.match(panel, /id="ai-modify-plan"/);
  assert.match(panel, /id="ai-modify-files"/);
  assert.match(panel, /id="ai-modify-diff"/);
  assert.match(panel, /id="ai-modify-approve"[^>]*disabled/);
  assert.match(panel, /id="ai-modify-cancel"/);
  assert.match(panel, /id="ai-modify-reject"/);
  assert.match(panel, /id="ai-modify-history"/);
  assert.match(panel, /no AI request, file write, code execution/);
  assert.match(app, /recordLabAiModifyEvent\(outcome\)/);
  assert.doesNotMatch(app.slice(app.indexOf('function submitLabAiModifyRequest'), app.indexOf('function cancelLabAiModifyRequest')), /fetch\(|\/api\/chat|writeFile|eval\(/);
  assert.match(app, /message\.textContent = redactSensitiveText\(entry\.message\)/);
});

test('history rejects malformed entries and unknown statuses', () => {
  const storage = createStorage();
  storage.values.set(LAB_AI_MODIFY_HISTORY_KEY, JSON.stringify([
    { timestamp: 1, status: 'unavailable', message: 'untrusted message' },
    { timestamp: 2, status: 'generated', message: 'pretend proposal' },
    { timestamp: '3', status: 'cancelled' },
  ]));

  assert.deepEqual(loadLabAiModifyHistory(storage), [{
    timestamp: 1,
    status: 'unavailable',
    message: 'Plan not generated · AI Modify integration unavailable',
  }]);
  assert.throws(() => recordLabAiModifyHistory(storage, 'generated'), TypeError);
});
