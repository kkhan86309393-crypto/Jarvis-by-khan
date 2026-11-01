export const DEFAULT_FOCUS_DURATION_SECONDS = 25 * 60;
export const FOCUS_TIMER_STORAGE_KEY = 'jarvis.focus.timer.v1';

export function createFocusTimerState() {
  return {
    remainingSeconds: DEFAULT_FOCUS_DURATION_SECONDS,
    running: false,
    resumable: false,
    deadline: null,
    taskId: null,
    taskTitle: null,
  };
}

function isValidTaskReference(taskId, taskTitle) {
  return (taskId === null && taskTitle === null)
    || (typeof taskId === 'string' && taskId.length > 0 && taskId.length <= 200
      && typeof taskTitle === 'string' && taskTitle.length > 0 && taskTitle.length <= 200);
}

function isValidStoredRecord(record, now) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || record.version !== 1) return false;
  if (!['running', 'paused', 'completed'].includes(record.status)) return false;
  if (!Number.isInteger(record.remainingSeconds)
    || record.remainingSeconds < 0
    || record.remainingSeconds > DEFAULT_FOCUS_DURATION_SECONDS) return false;
  if (record.status === 'completed' ? record.remainingSeconds !== 0 : record.remainingSeconds < 1) return false;
  if (!Number.isFinite(record.savedAt) || record.savedAt < 0 || record.savedAt > now + 60_000) return false;
  return isValidTaskReference(record.taskId, record.taskTitle);
}

function toStoredRecord(timer, now, status = timer.running ? 'running' : 'paused') {
  const remainingSeconds = status === 'completed'
    ? 0
    : getFocusTimerRemaining(timer, now);
  if (!Number.isInteger(remainingSeconds)
    || remainingSeconds < 1
    || remainingSeconds > DEFAULT_FOCUS_DURATION_SECONDS) {
    throw new TypeError('Focus timer state is invalid.');
  }
  if (!isValidTaskReference(timer.taskId ?? null, timer.taskTitle ?? null)) {
    throw new TypeError('Focus timer task reference is invalid.');
  }
  return {
    version: 1,
    status,
    remainingSeconds,
    savedAt: now,
    taskId: timer.taskId ?? null,
    taskTitle: timer.taskTitle ?? null,
  };
}

function markCompleted(storage, record) {
  storage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify({
    ...record,
    status: 'completed',
    remainingSeconds: 0,
  }));
}

export function getFocusTimerRemaining(timer, now = Date.now()) {
  if (!timer.running) return timer.remainingSeconds;
  return Math.max(0, Math.ceil((timer.deadline - now) / 1000));
}

export function startFocusTimer(timer, now = Date.now()) {
  if (timer.running) return timer;
  if (timer.remainingSeconds <= 0) return timer;
  return {
    ...timer,
    running: true,
    resumable: true,
    deadline: now + timer.remainingSeconds * 1000,
  };
}

export function pauseFocusTimer(timer, now = Date.now()) {
  if (!timer.running) return timer;
  return {
    ...timer,
    remainingSeconds: getFocusTimerRemaining(timer, now),
    running: false,
    resumable: true,
    deadline: null,
  };
}

export function saveFocusTimer(storage, timer, now = Date.now()) {
  const record = toStoredRecord(timer, now);
  storage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(record));
  return record;
}

export function completeFocusTimer(storage, timer, now = Date.now()) {
  const record = {
    version: 1,
    status: 'completed',
    remainingSeconds: 0,
    savedAt: now,
    taskId: timer.taskId ?? null,
    taskTitle: timer.taskTitle ?? null,
  };
  if (!isValidTaskReference(record.taskId, record.taskTitle)) {
    throw new TypeError('Focus timer task reference is invalid.');
  }
  storage.setItem(FOCUS_TIMER_STORAGE_KEY, JSON.stringify(record));
  return createFocusTimerState();
}

export function loadFocusTimer(storage, now = Date.now()) {
  let serialized;
  try {
    serialized = storage.getItem(FOCUS_TIMER_STORAGE_KEY);
  } catch (error) {
    return {
      timer: createFocusTimerState(),
      storageAvailable: false,
      issue: error,
      completedWhileClosed: false,
    };
  }

  if (serialized === null) {
    return {
      timer: createFocusTimerState(),
      storageAvailable: true,
      issue: null,
      completedWhileClosed: false,
    };
  }

  let record;
  try {
    record = JSON.parse(serialized);
  } catch {
    return {
      timer: createFocusTimerState(),
      storageAvailable: true,
      issue: new Error('Saved focus timer data is not valid JSON.'),
      completedWhileClosed: false,
    };
  }
  if (!isValidStoredRecord(record, now)) {
    return {
      timer: createFocusTimerState(),
      storageAvailable: true,
      issue: new Error('Saved focus timer data has an unsupported format.'),
      completedWhileClosed: false,
    };
  }

  if (record.status === 'completed') {
    return {
      timer: createFocusTimerState(),
      storageAvailable: true,
      issue: null,
      completedWhileClosed: false,
    };
  }

  let remainingSeconds = record.remainingSeconds;
  if (record.status === 'running') {
    remainingSeconds = Math.max(0, Math.ceil(
      (record.remainingSeconds * 1000 - Math.max(0, now - record.savedAt)) / 1000,
    ));
    if (remainingSeconds === 0) {
      try {
        markCompleted(storage, record);
      } catch (error) {
        return {
          timer: createFocusTimerState(),
          storageAvailable: false,
          issue: error,
          completedWhileClosed: true,
        };
      }
      return {
        timer: createFocusTimerState(),
        storageAvailable: true,
        issue: null,
        completedWhileClosed: true,
        completedTaskTitle: record.taskTitle,
      };
    }
  }

  return {
    timer: {
      remainingSeconds,
      running: record.status === 'running',
      resumable: true,
      deadline: record.status === 'running' ? now + remainingSeconds * 1000 : null,
      taskId: record.taskId,
      taskTitle: record.taskTitle,
    },
    storageAvailable: true,
    issue: null,
    completedWhileClosed: false,
  };
}
