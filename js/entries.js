import { intervalOverlaps, localDateKey, splitInterval, validateEntry } from "./validation.js";
import { loadState, saveState } from "./storage.js";
import { calculateTimer, settleTimer } from "./timer.js";

function createId() {
  return crypto.randomUUID();
}

function assertTask(state, taskId) {
  if (!state.tasks.some((task) => task.id === taskId)) throw new Error("Choose a valid task.");
}

function activeTimerForValidation(state, now) {
  if (!state.active_timer) return null;
  const calculated = calculateTimer(state.active_timer, state.entries, now);
  const end = calculated.reachedLimit
    ? Date.parse(calculated.stop_at)
    : now;
  return {
    ...state.active_timer,
    started_at: state.active_timer.started_at,
    ended_at: new Date(Math.max(Date.parse(state.active_timer.started_at), end)).toISOString(),
  };
}

export function createTask(name, notes = "") {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error("Task name must be between 1 and 100 characters.");
  if (notes.length > 500) throw new Error("Task notes must be 500 characters or fewer.");
  const state = loadState();
  const now = new Date().toISOString();
  const task = { id: createId(), name: trimmed, notes: notes.trim(), created_at: now, updated_at: now };
  state.tasks.push(task);
  saveState(state);
  return task;
}

export function renameTask(taskId, name, notes = null) {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 100) throw new Error("Task name must be between 1 and 100 characters.");
  if (notes !== null && notes.length > 500) throw new Error("Task notes must be 500 characters or fewer.");
  const state = loadState();
  const task = state.tasks.find((candidate) => candidate.id === taskId);
  if (!task) throw new Error("Task not found.");
  task.name = trimmed;
  if (notes !== null) task.notes = notes.trim();
  task.updated_at = new Date().toISOString();
  saveState(state);
  return task;
}

export function listEntries({ from = null, to = null } = {}, now = Date.now()) {
  const state = loadState();
  const results = state.entries.filter((entry) => {
    if (!from && !to) return true;
    return splitInterval(entry.started_at, entry.ended_at)
      .some((segment) => (!from || segment.date >= from) && (!to || segment.date <= to));
  }).map((entry) => {
    const task = state.tasks.find((candidate) => candidate.id === entry.task_id);
    return { ...entry, task_name: task?.name || "Unknown task", task_notes: task?.notes || "" };
  });
  if (state.active_timer) {
    const calculated = calculateTimer(state.active_timer, state.entries, now);
    if (calculated.elapsed_ms > 0) {
      const task = state.tasks.find((candidate) => candidate.id === state.active_timer.task_id);
      const activeEntry = {
        id: null,
        task_id: state.active_timer.task_id,
        task_name: task?.name || "Unknown task",
        task_notes: task?.notes || "",
        started_at: state.active_timer.started_at,
        ended_at: calculated.segments[calculated.segments.length - 1].ended_at,
        notes: "",
        source: "timer",
        running: true,
      };
      if (!from || splitInterval(activeEntry.started_at, activeEntry.ended_at)
        .some((segment) => segment.date >= from && (!to || segment.date <= to))) {
        results.push(activeEntry);
      }
    }
  }
  return results.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

export function saveEntry({ id = null, task_id, started_at, ended_at, notes = "" }, now = Date.now()) {
  let state = loadState();
  if (state.active_timer) {
    settleTimer(now);
    state = loadState();
  }
  assertTask(state, task_id);
  if (typeof notes !== "string" || notes.length > 1000) {
    throw new Error("Entry notes must be 1,000 characters or fewer.");
  }
  const existing = id ? state.entries.find((entry) => entry.id === id) : null;
  if (id && !existing) throw new Error("Time entry not found.");
  const activeTimer = activeTimerForValidation(state, now);
  validateEntry({ started_at, ended_at }, {
    entries: state.entries,
    activeTimer,
    now,
    excludeId: id,
  });

  const timestamp = new Date(now).toISOString();
  const entry = {
    id: id || createId(),
    task_id,
    started_at: new Date(Date.parse(started_at)).toISOString(),
    ended_at: new Date(Date.parse(ended_at)).toISOString(),
    notes: notes.trim(),
    source: existing?.source || "manual",
    created_at: existing?.created_at || timestamp,
    updated_at: timestamp,
  };
  if (existing) {
    state.entries[state.entries.indexOf(existing)] = entry;
  } else {
    state.entries.push(entry);
  }
  saveState(state);
  return entry;
}

export function deleteEntry(entryId) {
  const state = loadState();
  const index = state.entries.findIndex((entry) => entry.id === entryId);
  if (index < 0) throw new Error("Time entry not found.");
  state.entries.splice(index, 1);
  saveState(state);
}

export function getDailyEntries(date = localDateKey(), now = Date.now()) {
  return listEntries({ from: date, to: date }, now);
}

export function getTodayTotalsByTask(now = Date.now()) {
  const state = loadState();
  const today = localDateKey(now);
  const totals = new Map();
  for (const entry of state.entries) {
    for (const segment of splitInterval(entry.started_at, entry.ended_at)) {
      if (segment.date === today) {
        totals.set(entry.task_id, (totals.get(entry.task_id) || 0) + segment.duration_ms);
      }
    }
  }
  if (state.active_timer) {
    const calculated = calculateTimer(state.active_timer, state.entries, now);
    for (const segment of calculated.segments) {
      if (segment.date === today) {
        totals.set(state.active_timer.task_id, (totals.get(state.active_timer.task_id) || 0) + segment.duration_ms);
      }
    }
  }
  return totals;
}

export function entriesOverlap(entryA, entryB) {
  return intervalOverlaps(
    Date.parse(entryA.started_at),
    Date.parse(entryA.ended_at),
    Date.parse(entryB.started_at),
    Date.parse(entryB.ended_at),
  );
}
