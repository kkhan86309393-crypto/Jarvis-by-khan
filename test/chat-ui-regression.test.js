import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [app, html] = await Promise.all([
  readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
]);

const functionBody = (name, source = app) => {
  const match = source.match(new RegExp(`function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n\\}`));
  assert.ok(match, `${name} should be defined`);
  return match[1];
};

test('keeps loading and error status visible in both chat views', () => {
  for (const id of ['dashboard-chat-state', 'conversation-chat-state']) {
    assert.match(html, new RegExp(`id="${id}"[^>]*role="status"[^>]*aria-live="polite"[^>]*hidden`));
  }

  const updateStatus = functionBody('setDashboardChatState');
  assert.match(updateStatus, /\[elements\.dashboardChatState, elements\.dashboardChatStateLabel, elements\.dashboardRetryButton\]/);
  assert.match(updateStatus, /\[elements\.conversationChatState, elements\.conversationChatStateLabel, elements\.conversationRetryButton\]/);
  assert.match(updateStatus, /container\.hidden = !message/);
  assert.match(updateStatus, /container\.dataset\.state = mode/);
  assert.match(updateStatus, /label\.textContent = translateUiText\(message, state\.preferences\.language\)/);
  assert.match(updateStatus, /retryButton\.hidden = !canRetry/);

  const sendChat = functionBody('sendChat', app);
  assert.match(sendChat, /setDashboardChatState\('thinking', 'J\.A\.R\.V\.I\.S\. is processing your message\.'\)/);
  assert.match(sendChat, /setDashboardChatState\('error', message, true\)/);
});

test('both retry buttons use one guarded retry without appending another user message', () => {
  assert.match(app, /elements\.dashboardRetryButton\.addEventListener\('click', retryLastChat\)/);
  assert.match(app, /elements\.conversationRetryButton\.addEventListener\('click', retryLastChat\)/);

  const retry = functionBody('retryLastChat');
  assert.match(retry, /if \(state\.pending \|\| !state\.lastChatFailure\) return/);
  assert.ok(retry.indexOf('state.pending = true') < retry.indexOf('sendChat(failure.text'));
  assert.doesNotMatch(retry, /addMessage|state\.messages\.push/);
  assert.match(retry, /retry: true/);
  assert.doesNotMatch(retry, /provider\s*:/);
  assert.match(app, /provider = elements\.aiProvider\.value/);
  assert.match(app, /body: JSON\.stringify\(\{\s*provider,\s*messages: context/);

  const submit = functionBody('submitMessage');
  assert.match(submit, /if \(state\.pending\) return/);
  assert.match(submit, /addMessage\(\{ role: 'user', content: outgoingText \}\)/);
  assert.ok(submit.indexOf('state.pending = true') < submit.indexOf('sendChat(outgoingText)'));

  const summarize = functionBody('summarizeSearchResults');
  assert.match(summarize, /if \(state\.pending\) return/);
  assert.ok(summarize.indexOf('state.pending = true') < summarize.indexOf('sendChat(prompt'));
});

test('successful retries clear both errors and append the assistant reply once; failures remain retryable', () => {
  const sendChat = functionBody('sendChat');
  const successStart = sendChat.indexOf('state.lastChatFailure = null;');
  const successEnd = sendChat.indexOf('} catch (error) {');
  const successPath = sendChat.slice(successStart, successEnd);
  assert.match(successPath, /setDashboardChatState\('', ''\)/);
  assert.match(successPath, /addMessage\(replyMessage\)/);
  assert.equal((successPath.match(/addMessage\(replyMessage\)/g) || []).length, 1);

  const failurePath = sendChat.slice(successEnd);
  assert.match(failurePath, /state\.lastChatFailure = \{ text, message, contextOverride, maxTokens, singleAttempt \}/);
  assert.match(failurePath, /setDashboardChatState\('error', message, true\)/);
});

test('chat requests continue to use the selected English or Hindi language preference', () => {
  const sendChat = functionBody('sendChat');
  assert.match(app, /provider = elements\.aiProvider\.value/);
  assert.match(sendChat, /provider,\s*messages: context/);
  assert.match(sendChat, /language: state\.preferences\.language/);
  assert.match(app, /state\.preferences\.language = elements\.language\.value/);
});
