import assert from 'node:assert/strict';
import test from 'node:test';
import {
  completeFocusTimer,
  createFocusTimerState,
  DEFAULT_FOCUS_DURATION_SECONDS,
  FOCUS_TIMER_STORAGE_KEY,
  getFocusTimerRemaining,
  loadFocusTimer,
  pauseFocusTimer,
  saveFocusTimer,
  startFocusTimer,
} from '../public/focus-timer.js';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

test('Start → Reload restores a running timer with elapsed wall-clock time deducted', () => {
  const storage = createStorage();
  const started = startFocusTimer({ ...createFocusTimerState(), remainingSeconds: 100 }, 1_000);
  saveFocusTimer(storage, started, 1_000);

  const restored = loadFocusTimer(storage, 8_000);

  assert.equal(restored.timer.running, true);
  assert.equal(restored.timer.remainingSeconds, 93);
  assert.equal(getFocusTimerRemaining(restored.timer, 8_000), 93);
  assert.equal(getFocusTimerRemaining(restored.timer, 9_000), 92);
});

test('Pause → Reload keeps the paused remaining time unchanged', () => {
  const storage = createStorage();
  const running = startFocusTimer({ ...createFocusTimerState(), remainingSeconds: 90 }, 10_000);
  const paused = pauseFocusTimer(running, 27_100);
  saveFocusTimer(storage, paused, 27_100);

  const restored = loadFocusTimer(storage, 500_000);

  assert.equal(paused.remainingSeconds, 73);
  assert.equal(restored.timer.running, false);
  assert.equal(restored.timer.remainingSeconds, 73);
  assert.equal(restored.timer.deadline, null);
});

test('pausing at the initial duration restores as Resume, not a new Start', () => {
  const storage = createStorage();
  const paused = pauseFocusTimer(
    startFocusTimer(createFocusTimerState(), 1_000),
    1_000,
  );
  saveFocusTimer(storage, paused, 1_000);

  const restored = loadFocusTimer(storage, 2_000);

  assert.equal(restored.timer.remainingSeconds, DEFAULT_FOCUS_DURATION_SECONDS);
  assert.equal(restored.timer.resumable, true);
  assert.equal(restored.timer.running, false);
});

test('Resume → Reload continues from the paused value', () => {
  const storage = createStorage();
  const paused = { ...createFocusTimerState(), remainingSeconds: 60 };
  saveFocusTimer(storage, paused, 100);
  const restoredPaused = loadFocusTimer(storage, 50_000).timer;
  const resumed = startFocusTimer(restoredPaused, 50_000);
  saveFocusTimer(storage, resumed, 50_000);

  const restoredRunning = loadFocusTimer(storage, 60_000);

  assert.equal(restoredRunning.timer.running, true);
  assert.equal(restoredRunning.timer.remainingSeconds, 50);
});

test('completed timer resets once and does not restart after a later reload', () => {
  const storage = createStorage();
  const running = startFocusTimer({ ...createFocusTimerState(), remainingSeconds: 2 }, 1_000);
  saveFocusTimer(storage, running, 1_000);

  const expired = loadFocusTimer(storage, 3_000);
  assert.equal(expired.completedWhileClosed, true);
  assert.equal(expired.timer.running, false);
  assert.equal(expired.timer.remainingSeconds, DEFAULT_FOCUS_DURATION_SECONDS);
  assert.equal(JSON.parse(storage.getItem(FOCUS_TIMER_STORAGE_KEY)).status, 'completed');

  const reloaded = loadFocusTimer(storage, 4_000);
  assert.equal(reloaded.completedWhileClosed, false);
  assert.equal(reloaded.timer.running, false);
  assert.equal(reloaded.timer.remainingSeconds, DEFAULT_FOCUS_DURATION_SECONDS);

  const completed = completeFocusTimer(storage, running, 3_000);
  assert.equal(completed.running, false);
  assert.equal(completed.remainingSeconds, DEFAULT_FOCUS_DURATION_SECONDS);
});

test('invalid/corrupt timer data falls back safely, and inaccessible storage is reported', () => {
  const storage = createStorage();
  storage.setItem(FOCUS_TIMER_STORAGE_KEY, '{broken');
  const corrupt = loadFocusTimer(storage, 5_000);
  assert.equal(corrupt.storageAvailable, true);
  assert.match(corrupt.issue.message, /not valid JSON/);
  assert.equal(corrupt.timer.running, false);
  assert.equal(corrupt.timer.remainingSeconds, DEFAULT_FOCUS_DURATION_SECONDS);

  storage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify({
    version: 1,
    status: 'running',
    remainingSeconds: -4,
    savedAt: 1,
    taskId: null,
    taskTitle: null,
  }));
  const unsupported = loadFocusTimer(storage, 5_000);
  assert.match(unsupported.issue.message, /unsupported format/);
  assert.equal(unsupported.timer.remainingSeconds, DEFAULT_FOCUS_DURATION_SECONDS);

  storage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify({
    version: 1,
    status: 'running',
    remainingSeconds: 30,
    savedAt: Number.MAX_SAFE_INTEGER,
    taskId: null,
    taskTitle: null,
  }));
  assert.match(loadFocusTimer(storage, 5_000).issue.message, /unsupported format/);

  const unavailable = loadFocusTimer({
    getItem() {
      throw new Error('Storage blocked');
    },
  });
  assert.equal(unavailable.storageAvailable, false);
  assert.match(unavailable.issue.message, /Storage blocked/);
  assert.equal(unavailable.timer.running, false);

  assert.throws(() => saveFocusTimer({
    setItem() {
      throw new Error('Storage quota exceeded');
    },
  }, createFocusTimerState()), /Storage quota exceeded/);
});

test('Active Task ID and title are restored with the running timer', () => {
  const storage = createStorage();
  const timer = startFocusTimer({
    ...createFocusTimerState(),
    remainingSeconds: 120,
    taskId: 'task-42',
    taskTitle: 'Review local report',
  }, 20_000);
  saveFocusTimer(storage, timer, 20_000);

  const restored = loadFocusTimer(storage, 25_000);

  assert.equal(restored.timer.taskId, 'task-42');
  assert.equal(restored.timer.taskTitle, 'Review local report');
  assert.equal(restored.timer.remainingSeconds, 115);
});

test('app restores the timer after local tasks load and clears it with saved local data', () => {
  assert.match(app, /initializeLocalPlanner\(\);\s*initializeFocusTimer\(\)/);
  assert.match(app, /function initializeFocusTimer\(\)[\s\S]*?loadFocusTimer\(localStorage\)/);
  assert.match(app, /function toggleFocusTimer\(\)[\s\S]*?pauseFocusTimer\(/);
  assert.match(app, /function toggleFocusTimer\(\)[\s\S]*?startFocusTimer\(/);
  assert.match(app, /localStorage\.removeItem\(FOCUS_TIMER_STORAGE_KEY\)/);
});
