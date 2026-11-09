import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import {
  clearAllData,
  createInitialState,
  exportBackup,
  loadState,
  mergeBackup,
  parseBackup,
  saveState,
} from "../js/storage.js";
import { createTask, deleteEntry, listEntries, saveEntry } from "../js/entries.js";
import { calculateTimer, getTimerStatus, startTimer, stopTimer } from "../js/timer.js";
import { buildReport } from "../js/reports.js";
import { localDateKey, MAX_DAILY_MS, splitInterval } from "../js/validation.js";

class MemoryStorage {
  #data = new Map();
  getItem(key) { return this.#data.get(key) ?? null; }
  setItem(key, value) { this.#data.set(key, String(value)); }
  removeItem(key) { this.#data.delete(key); }
}

beforeEach(() => {
  globalThis.localStorage = new MemoryStorage();
  clearAllData();
});

function localDateTime(date, hour, minute = 0) {
  return new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
}

function freezeClock(timestamp) {
  const original = Date.now;
  Date.now = () => timestamp;
  return () => { Date.now = original; };
}

test("localStorage initializes and persists a valid browser-only dataset", () => {
  const initial = loadState();
  assert.deepEqual(initial, createInitialState());
  const task = createTask("Placement research");
  assert.equal(loadState().tasks[0].id, task.id);
});

test("cross-midnight intervals split into local calendar days", () => {
  const date = localDateKey();
  const start = localDateTime(date, 23).getTime();
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(2);
  const segments = splitInterval(start, end.getTime());
  assert.equal(segments.length, 2);
  assert.equal(segments[0].duration_ms, 60 * 60 * 1000);
  assert.equal(segments[1].duration_ms, 2 * 60 * 60 * 1000);
});

test("the 16-hour cap applies across tasks for each calendar day", () => {
  const date = localDateKey();
  const start = localDateTime(date, 0).getTime();
  const now = start + 17 * 60 * 60 * 1000;
  const restoreClock = freezeClock(now);
  try {
    const first = createTask("Preparation");
    const second = createTask("Workshop");
    saveEntry({
      task_id: first.id,
      started_at: new Date(start).toISOString(),
      ended_at: new Date(start + 10 * 3600000).toISOString(),
    }, now);
    saveEntry({
      task_id: second.id,
      started_at: new Date(start + 10 * 3600000).toISOString(),
      ended_at: new Date(start + 16 * 3600000).toISOString(),
    }, now);
    assert.throws(() => saveEntry({
      task_id: second.id,
      started_at: new Date(start + 16 * 3600000).toISOString(),
      ended_at: new Date(start + 16 * 3600000 + 60000).toISOString(),
    }, now), /16-hour limit/);
    assert.equal(loadState().entries.reduce((sum, entry) =>
      sum + Date.parse(entry.ended_at) - Date.parse(entry.started_at), 0), MAX_DAILY_MS);
  } finally {
    restoreClock();
  }
});

test("overlapping sessions are rejected and saved entries can be deleted", () => {
  const now = Date.now();
  const restoreClock = freezeClock(now);
  try {
    const task = createTask("Documentation");
    const start = new Date(now - 3 * 3600000);
    saveEntry({
      task_id: task.id,
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + 3600000).toISOString(),
    }, now);
    assert.throws(() => saveEntry({
      task_id: task.id,
      started_at: new Date(start.getTime() + 1800000).toISOString(),
      ended_at: new Date(start.getTime() + 5400000).toISOString(),
    }, now), /overlaps/);
    const entryId = loadState().entries[0].id;
    deleteEntry(entryId);
    assert.equal(loadState().entries.length, 0);
  } finally {
    restoreClock();
  }
});

test("a timer survives reload and stops exactly at the daily cap", () => {
  const date = localDateKey();
  const start = localDateTime(date, 0).getTime();
  const restoreClock = freezeClock(start + 17 * 3600000);
  try {
    const task = createTask("Placement duties");
    saveEntry({
      task_id: task.id,
      started_at: new Date(start).toISOString(),
      ended_at: new Date(start + 15 * 3600000).toISOString(),
    }, Date.now());
    startTimer(task.id, start + 15 * 3600000);
    const status = getTimerStatus(start + 17 * 3600000);
    assert.equal(status.reachedLimit, true);
    assert.equal(loadState().active_timer, null);
    const entries = loadState().entries;
    assert.equal(entries.length, 2);
    assert.equal(entries.reduce((sum, entry) => sum + Date.parse(entry.ended_at) - Date.parse(entry.started_at), 0), MAX_DAILY_MS);
  } finally {
    restoreClock();
  }
});

test("timer time is allocated across midnight without exceeding either day", () => {
  const date = localDateKey();
  const start = localDateTime(date, 23).getTime();
  const restoreClock = freezeClock(start + 3 * 3600000);
  try {
    const task = createTask("Evening shift");
    const running = startTimer(task.id, start);
    assert.equal(running.timer.task_id, task.id);
    const calculated = calculateTimer(loadState().active_timer, [], start + 3 * 3600000);
    assert.equal(calculated.elapsed_ms, 3 * 3600000);
    assert.equal(calculated.segments.length, 2);
    stopTimer(start + 3 * 3600000);
    assert.equal(loadState().entries.length, 1);
  } finally {
    restoreClock();
  }
});

test("backup validation, restore parsing, and merge preserve stable IDs", () => {
  const now = Date.now();
  const restoreClock = freezeClock(now);
  try {
    const task = createTask("Evidence collection");
    const backup = exportBackup();
    assert.equal(parseBackup(JSON.stringify(backup), now).tasks[0].id, task.id);
    const merged = mergeBackup(createInitialState(), backup.data, now);
    assert.equal(merged.data.tasks.length, 1);
    const mergedAgain = mergeBackup(merged.data, backup.data, now);
    assert.equal(mergedAgain.data.tasks.length, 1);
    assert.throws(() => parseBackup('{"schema":"wrong"}', now), /supported/);
    const invalid = structuredClone(backup);
    invalid.data.tasks[0].name = " ";
    assert.throws(() => parseBackup(JSON.stringify(invalid), now), /invalid|task/i);
  } finally {
    restoreClock();
  }
});

test("reports provide date ranges and structured task and entry totals", () => {
  const now = Date.now();
  const restoreClock = freezeClock(now);
  try {
    const task = createTask("Client support");
    const start = new Date(now - 2 * 3600000);
    saveEntry({
      task_id: task.id,
      started_at: start.toISOString(),
      ended_at: new Date(start.getTime() + 3600000).toISOString(),
    }, now);
    const report = buildReport({ period: "daily", date: localDateKey(now), now });
    assert.equal(report.entries.length, 1);
    assert.equal(report.total_ms, 3600000);
    assert.equal(report.tasks[0].task_name, "Client support");
  } finally {
    restoreClock();
  }
});

test("clear removes only the application dataset", () => {
  const task = createTask("A task");
  assert.ok(task.id);
  saveState({ ...loadState(), profile: { full_name: "Student", company_name: "Company" } });
  clearAllData();
  assert.equal(loadState().tasks.length, 0);
  assert.equal(listEntries().length, 0);
});
