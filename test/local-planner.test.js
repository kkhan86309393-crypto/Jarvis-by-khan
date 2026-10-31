import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createNote,
  createTask,
  getDailyProductivityInsights,
  getTaskPrioritySummary,
  loadNotes,
  loadTasks,
  NOTES_STORAGE_KEY,
  saveNotes,
  saveTasks,
  setTaskCompleted,
  TASKS_STORAGE_KEY,
  updateNote,
  updateTask,
} from '../public/local-planner.js';

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
}

test('stores, reloads, edits, and deletes notes with creation and update timestamps', () => {
  const storage = createStorage();
  const created = createNote({ title: '  Project  ', content: 'First draft' }, new Date('2026-10-30T12:00:00Z'));
  saveNotes(storage, [created]);
  assert.deepEqual(loadNotes(storage), [created]);

  const edited = updateNote(created, { title: 'Project plan', content: 'Revised' }, new Date('2026-10-31T12:00:00Z'));
  assert.equal(edited.id, created.id);
  assert.equal(edited.createdAt, created.createdAt);
  assert.equal(edited.updatedAt, '2026-10-31T12:00:00.000Z');
  saveNotes(storage, [edited]);
  assert.deepEqual(loadNotes(storage), [edited]);

  saveNotes(storage, []);
  assert.deepEqual(loadNotes(storage), []);
  assert.ok(storage.getItem(NOTES_STORAGE_KEY));
});

test('stores, edits, completes, and deletes tasks independently of notes', () => {
  const storage = createStorage();
  const note = createNote({ title: 'Keep', content: '' });
  const task = createTask({ title: 'Review draft', details: 'Check the summary' });
  saveNotes(storage, [note]);
  saveTasks(storage, [task]);

  const edited = updateTask(task, { title: 'Review final draft' });
  const completed = setTaskCompleted(edited, true);
  saveTasks(storage, [completed]);

  assert.equal(loadTasks(storage)[0].title, 'Review final draft');
  assert.equal(loadTasks(storage)[0].completed, true);
  assert.deepEqual(loadNotes(storage), [note]);
  saveTasks(storage, []);
  assert.deepEqual(loadTasks(storage), []);
  assert.ok(storage.getItem(TASKS_STORAGE_KEY));
});

test('rejects blank titles, oversized fields, and malformed saved data', () => {
  assert.throws(() => createNote({ title: '  ', content: '' }), /Note title/);
  assert.throws(() => createTask({ title: 'x'.repeat(201) }), /Task title/);

  const storage = createStorage();
  storage.setItem(NOTES_STORAGE_KEY, '{bad json');
  assert.throws(() => loadNotes(storage), /not valid JSON/);
  storage.setItem(TASKS_STORAGE_KEY, JSON.stringify([{ id: 'broken' }]));
  assert.throws(() => loadTasks(storage), /unsupported format/);
});

test('rejects invalid completion values and does not change task creation time on updates', () => {
  const task = createTask({ title: 'Submit report' }, new Date('2026-10-30T12:00:00Z'));
  const updated = setTaskCompleted(task, true, new Date('2026-11-01T12:00:00Z'));

  assert.equal(updated.createdAt, task.createdAt);
  assert.equal(updated.updatedAt, '2026-11-01T12:00:00.000Z');
  assert.equal(updated.completedAt, updated.updatedAt);
  assert.equal(setTaskCompleted(updated, false).completedAt, null);
  assert.throws(() => setTaskCompleted(task, 'yes'), /true or false/);
  assert.throws(() => updateTask(task, { title: '' }), /Task title/);
});

test('prioritizes the oldest incomplete task and reports local daily totals', () => {
  const now = new Date('2026-10-30T12:00:00');
  const olderPending = createTask({ title: 'Older task' }, new Date('2026-10-20T12:00:00'));
  const newerPending = createTask({ title: 'Newer task' }, new Date('2026-10-29T12:00:00'));
  const completedToday = setTaskCompleted(
    createTask({ title: 'Done today' }, new Date('2026-10-28T12:00:00')),
    true,
    now,
  );
  const editedCompletedYesterday = updateTask(
    setTaskCompleted(
      createTask({ title: 'Done yesterday' }, new Date('2026-10-28T12:00:00')),
      true,
      new Date('2026-10-29T12:00:00'),
    ),
    { title: 'Edited today' },
    now,
  );
  const completedEarlier = setTaskCompleted(
    createTask({ title: 'Done earlier' }, new Date('2026-10-28T12:00:00')),
    true,
    new Date('2026-10-29T12:00:00'),
  );
  const summary = getTaskPrioritySummary(
    [newerPending, completedToday, olderPending, completedEarlier, editedCompletedYesterday],
    ['Focus timer started', 'Assistant reply received'],
    now,
  );

  assert.equal(summary.pendingCount, 2);
  assert.equal(summary.completedToday, 1);
  assert.equal(summary.suggestedTask.id, olderPending.id);
  assert.equal(summary.daysPending, 10);
  assert.equal(summary.recentFocusActivity, 'Focus timer started');
  assert.equal(summary.summary, '2 pending · 1 completed today');
});

test('computes daily insights only from dated task completions and available focus activity', () => {
  const now = new Date('2026-10-30T12:00:00');
  const focusStart = new Date(2026, 9, 30, 10, 0).toISOString();
  const focusComplete = new Date(2026, 9, 30, 10, 25).toISOString();
  const previousDayFocus = new Date(2026, 9, 29, 10, 25).toISOString();
  const oldest = createTask({ title: 'Review local data' }, new Date('2026-10-20T12:00:00'));
  const pending = createTask({ title: 'Plan next step' }, new Date('2026-10-29T12:00:00'));
  const completedToday = setTaskCompleted(
    createTask({ title: 'Completed today' }),
    true,
    now,
  );
  const legacyCompleted = {
    ...setTaskCompleted(createTask({ title: 'Legacy completion' }), true, new Date('2026-10-29T12:00:00')),
  };
  delete legacyCompleted.completedAt;
  const activity = [
    { message: 'Focus timer started: Review local data', timestamp: focusStart },
    { message: 'Focus session complete: Review local data', timestamp: focusComplete },
    { message: 'Focus session complete', timestamp: previousDayFocus },
  ];

  const insights = getDailyProductivityInsights(
    [pending, legacyCompleted, oldest, completedToday],
    activity,
    now,
  );

  assert.equal(insights.totalTasks, 4);
  assert.equal(insights.pendingTasks, 2);
  assert.equal(insights.completedTasks, 2);
  assert.equal(insights.completedToday, 1);
  assert.equal(insights.focusSessionsToday, 1);
  assert.equal(insights.recentFocusActivity, 'Focus session complete: Review local data');
  assert.equal(insights.oldestPendingTask.id, oldest.id);
  assert.equal(insights.daysPending, 10);
  assert.match(insights.summary, /4 tasks · 2 pending · 2 completed · 1 completed today/);
  assert.equal(insights.nextAction, 'Start with "Review local data", pending for 10 days.');
});

test('reports no focus or pending task statistics when local data does not contain them', () => {
  const insights = getDailyProductivityInsights([], [], new Date('2026-10-30T12:00:00'));

  assert.equal(insights.focusSessionsToday, 0);
  assert.equal(insights.recentFocusActivity, '');
  assert.equal(insights.oldestPendingTask, null);
  assert.equal(insights.nextAction, 'Add a task when you are ready to plan your next step.');
});

test('dismisses the current suggestion without suggesting completed tasks', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const first = createTask({ title: 'First task' }, new Date('2026-10-28T12:00:00Z'));
  const second = createTask({ title: 'Second task' }, new Date('2026-10-29T12:00:00Z'));
  const done = setTaskCompleted(createTask({ title: 'Finished' }), true, now);

  assert.equal(getTaskPrioritySummary([done, first, second], [], now, [first.id]).suggestedTask.id, second.id);
  assert.equal(getTaskPrioritySummary([done], [], now).suggestedTask, null);
});
