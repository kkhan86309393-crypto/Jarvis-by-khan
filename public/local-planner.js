export const NOTES_STORAGE_KEY = 'jarvis.notes.v1';
export const TASKS_STORAGE_KEY = 'jarvis.tasks.v1';

const maxNoteTitleLength = 120;
const maxNoteContentLength = 12_000;
const maxTaskTitleLength = 200;
const maxTaskDetailsLength = 2_000;

function isValidTimestamp(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isValidBaseRecord(record, titleLimit, contentLimit) {
  return record
    && typeof record.id === 'string'
    && record.id.length > 0
    && record.id.length <= 100
    && typeof record.title === 'string'
    && record.title.trim().length > 0
    && record.title.length <= titleLimit
    && typeof record.content === 'string'
    && record.content.length <= contentLimit
    && isValidTimestamp(record.createdAt)
    && isValidTimestamp(record.updatedAt);
}

function readCollection(storage, key, label, isValidRecord) {
  const saved = storage.getItem(key);
  if (saved === null) return [];

  let records;
  try {
    records = JSON.parse(saved);
  } catch {
    throw new Error(`Saved ${label} data is not valid JSON.`);
  }
  if (!Array.isArray(records) || records.some((record) => !isValidRecord(record))) {
    throw new Error(`Saved ${label} data has an unsupported format.`);
  }
  return records;
}

function writeCollection(storage, key, records, label, isValidRecord) {
  if (!Array.isArray(records) || records.some((record) => !isValidRecord(record))) {
    throw new TypeError(`Cannot save invalid ${label} data.`);
  }
  storage.setItem(key, JSON.stringify(records));
}

function createId() {
  return globalThis.crypto?.randomUUID?.()
    || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function timestamp(now) {
  const value = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(value.getTime())) throw new TypeError('A valid date is required.');
  return value.toISOString();
}

function normalizeText(value, field, limit, required = false) {
  if (typeof value !== 'string') throw new TypeError(`${field} must be text.`);
  const normalized = value.trim();
  if (required && !normalized) throw new TypeError(`${field} cannot be empty.`);
  if (normalized.length > limit) throw new RangeError(`${field} must be ${limit} characters or fewer.`);
  return normalized;
}

function isValidNote(note) {
  return isValidBaseRecord(note, maxNoteTitleLength, maxNoteContentLength);
}

function isValidTask(task) {
  return isValidBaseRecord(task, maxTaskTitleLength, maxTaskDetailsLength)
    && typeof task.completed === 'boolean'
    && (task.completedAt === undefined || task.completedAt === null || isValidTimestamp(task.completedAt));
}

export function loadNotes(storage) {
  return readCollection(storage, NOTES_STORAGE_KEY, 'notes', isValidNote);
}

export function saveNotes(storage, notes) {
  writeCollection(storage, NOTES_STORAGE_KEY, notes, 'notes', isValidNote);
}

export function loadTasks(storage) {
  return readCollection(storage, TASKS_STORAGE_KEY, 'tasks', isValidTask);
}

export function saveTasks(storage, tasks) {
  writeCollection(storage, TASKS_STORAGE_KEY, tasks, 'tasks', isValidTask);
}

export function createNote({ title, content }, now = new Date()) {
  const createdAt = timestamp(now);
  return {
    id: createId(),
    title: normalizeText(title, 'Note title', maxNoteTitleLength, true),
    content: normalizeText(content, 'Note content', maxNoteContentLength),
    createdAt,
    updatedAt: createdAt,
  };
}

export function updateNote(note, { title, content }, now = new Date()) {
  if (!isValidNote(note)) throw new TypeError('Cannot update an invalid note.');
  return {
    ...note,
    title: normalizeText(title, 'Note title', maxNoteTitleLength, true),
    content: normalizeText(content, 'Note content', maxNoteContentLength),
    updatedAt: timestamp(now),
  };
}

export function createTask({ title, details = '' }, now = new Date()) {
  const createdAt = timestamp(now);
  return {
    id: createId(),
    title: normalizeText(title, 'Task title', maxTaskTitleLength, true),
    content: normalizeText(details, 'Task details', maxTaskDetailsLength),
    completed: false,
    completedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

export function updateTask(task, { title, details = task?.content }, now = new Date()) {
  if (!isValidTask(task)) throw new TypeError('Cannot update an invalid task.');
  return {
    ...task,
    title: normalizeText(title, 'Task title', maxTaskTitleLength, true),
    content: normalizeText(details, 'Task details', maxTaskDetailsLength),
    updatedAt: timestamp(now),
  };
}

export function setTaskCompleted(task, completed, now = new Date()) {
  if (!isValidTask(task)) throw new TypeError('Cannot update an invalid task.');
  if (typeof completed !== 'boolean') throw new TypeError('Task completion must be true or false.');
  const updatedAt = timestamp(now);
  return {
    ...task,
    completed,
    completedAt: completed ? updatedAt : null,
    updatedAt,
  };
}

function localDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function getTaskPrioritySummary(tasks, activityEntries = [], now = new Date(), dismissedIds = []) {
  if (!Array.isArray(tasks)) throw new TypeError('Tasks must be an array.');
  const validTasks = tasks.filter(isValidTask);
  const pending = validTasks
    .filter((task) => !task.completed)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const completedToday = validTasks.filter((task) => (
    task.completed && task.completedAt && localDateKey(task.completedAt) === localDateKey(now)
  )).length;
  const dismissed = new Set(dismissedIds);
  const suggestedTask = pending.find((task) => !dismissed.has(task.id)) || null;
  const recentFocusActivity = Array.isArray(activityEntries)
    ? activityEntries.find((entry) => typeof entry === 'string' && /focus (?:timer|session)/i.test(entry)) || ''
    : '';
  const daysPending = suggestedTask
    ? Math.max(0, Math.floor((new Date(now).getTime() - Date.parse(suggestedTask.createdAt)) / 86_400_000))
    : 0;

  return {
    pendingCount: pending.length,
    completedToday,
    suggestedTask,
    daysPending,
    recentFocusActivity,
    summary: `${pending.length} pending · ${completedToday} completed today`,
  };
}

export function getDailyProductivityInsights(tasks, activityEntries = [], now = new Date()) {
  if (!Array.isArray(tasks)) throw new TypeError('Tasks must be an array.');
  const validTasks = tasks.filter(isValidTask);
  const pending = validTasks
    .filter((task) => !task.completed)
    .sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const completed = validTasks.filter((task) => task.completed);
  const completedToday = completed.filter((task) => (
    task.completedAt && localDateKey(task.completedAt) === localDateKey(now)
  )).length;
  const activity = Array.isArray(activityEntries)
    ? activityEntries.filter((entry) => entry && typeof entry.message === 'string')
    : [];
  const focusActivity = activity
    .filter((entry) => /focus (?:timer|session)/i.test(entry.message))
    .sort((left, right) => Date.parse(right.timestamp || 0) - Date.parse(left.timestamp || 0));
  const focusSessionsToday = focusActivity.filter((entry) => (
    /focus session complete/i.test(entry.message)
      && isValidTimestamp(entry.timestamp)
      && localDateKey(entry.timestamp) === localDateKey(now)
  )).length;
  const oldestPendingTask = pending[0] || null;
  const daysPending = oldestPendingTask
    ? Math.max(0, Math.floor((new Date(now).getTime() - Date.parse(oldestPendingTask.createdAt)) / 86_400_000))
    : 0;
  const nextAction = oldestPendingTask
    ? `Start with "${oldestPendingTask.title}"${daysPending ? `, pending for ${daysPending} day${daysPending === 1 ? '' : 's'}` : ''}.`
    : 'Add a task when you are ready to plan your next step.';

  return {
    totalTasks: validTasks.length,
    pendingTasks: pending.length,
    completedTasks: completed.length,
    completedToday,
    focusSessionsToday,
    recentFocusActivity: focusActivity[0]?.message || '',
    oldestPendingTask,
    daysPending,
    summary: `${validTasks.length} task${validTasks.length === 1 ? '' : 's'} · ${pending.length} pending · ${completed.length} completed · ${completedToday} completed today`,
    nextAction,
  };
}
