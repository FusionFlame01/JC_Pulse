import { MAX_DAILY_MS, localDateKey, splitInterval, summarizeDailyTotals } from "./validation.js";
import { loadState, saveState } from "./storage.js";

export function calculateTimer(timer, entries, now = Date.now()) {
  const start = Date.parse(timer.started_at);
  const end = Math.max(start, now);
  const totals = summarizeDailyTotals(entries);
  const segments = [];
  let cursor = start;
  let reachedLimit = false;

  while (cursor < end) {
    const day = splitInterval(cursor, Math.min(end, nextLocalMidnight(cursor)))[0];
    const remaining = MAX_DAILY_MS - (totals.get(day.date) || 0);
    if (remaining <= 0) {
      reachedLimit = true;
      break;
    }
    const limitAt = cursor + remaining;
    const segmentEnd = Math.min(end, day.end_ms, limitAt);
    segments.push({
      date: day.date,
      started_at: new Date(cursor).toISOString(),
      ended_at: new Date(segmentEnd).toISOString(),
      duration_ms: segmentEnd - cursor,
    });
    if (limitAt < day.end_ms && limitAt <= end) {
      reachedLimit = true;
      break;
    }
    cursor = segmentEnd;
  }
  return {
    elapsed_ms: segments.reduce((sum, segment) => sum + segment.duration_ms, 0),
    segments,
    reachedLimit,
    stop_at: reachedLimit && segments.length
      ? segments[segments.length - 1].ended_at
      : null,
  };
}

function nextLocalMidnight(timestamp) {
  const date = new Date(timestamp);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

function createId() {
  return crypto.randomUUID();
}

function commitTimer(state, endedAt, now) {
  const start = Date.parse(state.active_timer.started_at);
  const end = Date.parse(endedAt);
  const entry = end > start ? {
    id: createId(),
    task_id: state.active_timer.task_id,
    started_at: new Date(start).toISOString(),
    ended_at: new Date(end).toISOString(),
    notes: "",
    source: "timer",
    created_at: new Date(now).toISOString(),
    updated_at: new Date(now).toISOString(),
  } : null;
  if (entry) {
    state.entries.push(entry);
  }
  state.active_timer = null;
  return entry;
}

export function getTimerStatus(now = Date.now()) {
  const state = loadState();
  if (!state.active_timer) return { timer: null, segments: [], elapsed_ms: 0 };
  const calculated = calculateTimer(state.active_timer, state.entries, now);
  if (calculated.reachedLimit) {
    commitTimer(state, calculated.stop_at, now);
    saveState(state);
    return { timer: null, segments: [], elapsed_ms: 0, reachedLimit: true };
  }
  const task = state.tasks.find((candidate) => candidate.id === state.active_timer.task_id);
  return {
    timer: { ...state.active_timer, task_name: task?.name || "Unknown task" },
    segments: calculated.segments,
    elapsed_ms: calculated.elapsed_ms,
  };
}

export function startTimer(taskId, now = Date.now()) {
  const state = loadState();
  if (state.active_timer) throw new Error("Stop or cancel the current timer before starting another.");
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error("Choose a task before starting the timer.");
  const totals = summarizeDailyTotals(state.entries);
  if ((totals.get(localDateKey(now)) || 0) >= MAX_DAILY_MS) {
    throw new Error("The 16-hour daily placement limit has been reached.");
  }
  state.active_timer = { task_id: taskId, started_at: new Date(now).toISOString() };
  saveState(state);
  return getTimerStatus(now);
}

export function stopTimer(now = Date.now()) {
  const state = loadState();
  if (!state.active_timer) throw new Error("There is no active timer to stop.");
  const calculated = calculateTimer(state.active_timer, state.entries, now);
  const endedAt = calculated.reachedLimit ? calculated.stop_at : new Date(now).toISOString();
  const entry = commitTimer(state, endedAt, now);
  saveState(state);
  return { entry, reachedLimit: calculated.reachedLimit };
}

export function cancelTimer() {
  const state = loadState();
  if (!state.active_timer) throw new Error("There is no active timer to cancel.");
  state.active_timer = null;
  saveState(state);
}

export function settleTimer(now = Date.now()) {
  return getTimerStatus(now);
}
