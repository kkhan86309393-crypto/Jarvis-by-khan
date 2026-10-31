import assert from 'node:assert/strict';
import test from 'node:test';
import { parseSmartCommand } from '../public/smart-command-router.js';

test('recognizes the supported English commands', () => {
  const examples = [
    ['Open dashboard', { type: 'dashboard' }],
    ['show my notes', { type: 'notes' }],
    ['Open tasks', { type: 'tasks' }],
    ['show pending tasks', { type: 'pending-tasks' }],
    ['List completed tasks', { type: 'completed-tasks' }],
    ['start the focus timer', { type: 'start-focus' }],
    ['pause focus timer', { type: 'pause-focus' }],
    ['show system status', { type: 'system-status' }],
    ['search saved notes for launch plan', { type: 'search-notes', query: 'launch plan' }],
    ['find notes about launch plan', { type: 'search-notes', query: 'launch plan' }],
    ['search notes', { type: 'search-notes', query: '' }],
  ];

  for (const [command, expected] of examples) {
    assert.deepEqual(parseSmartCommand(command), expected, command);
  }
});

test('recognizes safe Hindi equivalents', () => {
  const examples = [
    ['डैशबोर्ड खोलो', { type: 'dashboard' }],
    ['मेरे नोट्स दिखाओ', { type: 'notes' }],
    ['कार्य खोलें', { type: 'tasks' }],
    ['बाकी काम दिखाओ', { type: 'pending-tasks' }],
    ['पूरे काम दिखाओ', { type: 'completed-tasks' }],
    ['फोकस टाइमर शुरू करो', { type: 'start-focus' }],
    ['फोकस टाइमर रोक दो', { type: 'pause-focus' }],
    ['सिस्टम स्थिति दिखाओ', { type: 'system-status' }],
    ['नोट्स में खोजो योजना', { type: 'search-notes', query: 'योजना' }],
  ];

  for (const [command, expected] of examples) {
    assert.deepEqual(parseSmartCommand(command), expected, command);
  }
});

test('leaves normal chat and unsupported or destructive commands unhandled', () => {
  for (const text of [
    'Can you help me plan a dashboard?',
    'delete all my notes',
    'run JavaScript alert(1)',
    'open dashboard and delete the tasks',
    '',
    null,
  ]) {
    assert.equal(parseSmartCommand(text), null, String(text));
  }
});
