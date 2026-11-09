import { isDateKey, localDateKey, splitInterval } from "./validation.js";
import { loadState } from "./storage.js";
import { calculateTimer } from "./timer.js";

function dateAtNoon(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function shiftDate(dateKey, days) {
  const date = dateAtNoon(dateKey);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

export function getRange(period, date = localDateKey(), customStart = "", customEnd = "") {
  if (period !== "custom" && !isDateKey(date)) {
    throw new Error("Choose a valid date for this report.");
  }
  if (period === "daily") return { start: date, end: date };
  if (period === "weekly") {
    const selected = dateAtNoon(date);
    const weekday = (selected.getDay() + 6) % 7;
    const start = shiftDate(date, -weekday);
    return { start, end: shiftDate(start, 6) };
  }
  if (period === "monthly") {
    const selected = dateAtNoon(date);
    const year = selected.getFullYear();
    const month = selected.getMonth() + 1;
    return {
      start: `${year}-${String(month).padStart(2, "0")}-01`,
      end: localDateKey(new Date(year, month, 0, 12)),
    };
  }
  if (period === "custom" && isDateKey(customStart) && isDateKey(customEnd) && customStart <= customEnd) {
    return { start: customStart, end: customEnd };
  }
  throw new Error("Choose a valid daily, weekly, monthly, or custom report range.");
}

function makeReportEntries(state, range, now) {
  const allEntries = [...state.entries];
  if (state.active_timer) {
    const timer = calculateTimer(state.active_timer, state.entries, now);
    if (timer.elapsed_ms > 0) {
      allEntries.push({
        id: null,
        task_id: state.active_timer.task_id,
        started_at: state.active_timer.started_at,
        ended_at: timer.segments[timer.segments.length - 1].ended_at,
        notes: "",
        source: "timer",
        running: true,
      });
    }
  }

  const result = [];
  for (const entry of allEntries) {
    const task = state.tasks.find((candidate) => candidate.id === entry.task_id);
    for (const segment of splitInterval(entry.started_at, entry.ended_at)) {
      if (segment.date < range.start || segment.date > range.end) continue;
      result.push({
        id: entry.id,
        task_id: entry.task_id,
        task_name: task?.name || "Unknown task",
        task_notes: task?.notes || "",
        notes: entry.notes,
        source: entry.source,
        running: Boolean(entry.running),
        date: segment.date,
        started_at: segment.started_at,
        ended_at: segment.ended_at,
        duration_ms: segment.duration_ms,
      });
    }
  }
  return result.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

export function buildReport({
  period,
  date = localDateKey(),
  from = "",
  to = "",
  now = Date.now(),
} = {}) {
  const state = loadState();
  const range = getRange(period, date, from, to);
  const entries = makeReportEntries(state, range, now);
  const dailyMap = new Map();
  const taskMap = new Map();
  let totalMs = 0;
  for (const entry of entries) {
    dailyMap.set(entry.date, (dailyMap.get(entry.date) || 0) + entry.duration_ms);
    const task = taskMap.get(entry.task_id) || {
      task_id: entry.task_id,
      task_name: entry.task_name,
      total_ms: 0,
    };
    task.total_ms += entry.duration_ms;
    totalMs += entry.duration_ms;
    taskMap.set(entry.task_id, task);
  }

  const daily = [];
  for (let cursor = range.start; cursor <= range.end; cursor = shiftDate(cursor, 1)) {
    daily.push({ date: cursor, total_ms: dailyMap.get(cursor) || 0 });
    if (daily.length >= 4000) {
      throw new Error("The selected report range is too large. Choose a range of fewer than 4,000 days.");
    }
  }

  return {
    report_type: period,
    range,
    generated_at: new Date(now).toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    profile: state.profile,
    target_hours: state.settings.target_hours,
    total_ms: totalMs,
    daily,
    tasks: [...taskMap.values()].sort((a, b) => a.task_name.localeCompare(b.task_name)),
    entries,
  };
}

export function progressSummary(now = Date.now()) {
  const today = localDateKey(now);
  const selected = new Date(now);
  const year = selected.getFullYear();
  const month = selected.getMonth() + 1;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;
  const state = loadState();
  const weekRange = getRange("weekly", today);
  const dailyTotals = new Map();
  let totalMs = 0;
  let todayEntries = 0;
  const accumulate = (date, duration) => {
    dailyTotals.set(date, (dailyTotals.get(date) || 0) + duration);
    if (date === today) todayEntries += 1;
    totalMs += duration;
  };
  for (const entry of state.entries) {
    for (const segment of splitInterval(entry.started_at, entry.ended_at)) {
      accumulate(segment.date, segment.duration_ms);
    }
  }
  if (state.active_timer) {
    const timer = calculateTimer(state.active_timer, state.entries, now);
    for (const segment of timer.segments) {
      accumulate(segment.date, segment.duration_ms);
    }
  }
  let weekMs = 0;
  let monthMs = 0;
  for (const [date, duration] of dailyTotals) {
    if (date >= weekRange.start && date <= weekRange.end) weekMs += duration;
    if (date >= monthStart && date <= today) monthMs += duration;
  }
  return {
    today_ms: dailyTotals.get(today) || 0,
    week_ms: weekMs,
    month_ms: monthMs,
    total_ms: totalMs,
    today_entries: todayEntries,
    week_range: weekRange,
    month_range: { start: monthStart, end: localDateKey(new Date(year, month, 0, 12)) },
  };
}
