export const MAX_DAILY_MS = 16 * 60 * 60 * 1000;

export function localDateKey(timestamp = Date.now()) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime()))
    throw new Error("Choose a valid date and time.");
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function isDateKey(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

export function splitInterval(startValue, endValue) {
  const start =
    typeof startValue === "number" ? startValue : Date.parse(startValue);
  const end = typeof endValue === "number" ? endValue : Date.parse(endValue);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("End time must be after start time.");
  }

  const segments = [];
  let cursor = start;
  while (cursor < end) {
    const date = new Date(cursor);
    const nextMidnight = new Date(
      date.getFullYear(),
      date.getMonth(),
      date.getDate() + 1,
    ).getTime();
    const segmentEnd = Math.min(end, nextMidnight);
    segments.push({
      date: localDateKey(cursor),
      started_at: new Date(cursor).toISOString(),
      ended_at: new Date(segmentEnd).toISOString(),
      start_ms: cursor,
      end_ms: segmentEnd,
      duration_ms: segmentEnd - cursor,
    });
    cursor = segmentEnd;
  }
  return segments;
}

export function intervalOverlaps(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

export function summarizeDailyTotals(
  entries,
  excludedId = null,
  now = Date.now(),
) {
  const totals = new Map();
  for (const entry of entries) {
    if (entry.id === excludedId) continue;
    for (const segment of splitInterval(entry.started_at, entry.ended_at)) {
      totals.set(
        segment.date,
        (totals.get(segment.date) || 0) + segment.duration_ms,
      );
    }
  }
  return totals;
}

export function validateEntry(entry, context) {
  const {
    entries,
    activeTimer = null,
    now = Date.now(),
    excludeId = null,
    allowFuture = false,
  } = context;
  const start = Date.parse(entry.started_at);
  const end = Date.parse(entry.ended_at);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    throw new Error("Enter a valid start and end time.");
  }
  if (!allowFuture && end > now) {
    throw new Error("A completed time entry cannot end in the future.");
  }
  for (const existing of entries) {
    if (existing.id === excludeId) continue;
    if (
      intervalOverlaps(
        start,
        end,
        Date.parse(existing.started_at),
        Date.parse(existing.ended_at),
      )
    ) {
      throw new Error("This session overlaps another saved activity.");
    }
  }

  if (activeTimer) {
    const activeStart = Date.parse(activeTimer.started_at);
    const activeEnd = activeTimer.ended_at
      ? Date.parse(activeTimer.ended_at)
      : Math.max(activeStart, now);
    if (intervalOverlaps(start, end, activeStart, Math.max(activeStart, activeEnd))) {
      throw new Error("This session overlaps the active timer.");
    }
  }

  const totals = summarizeDailyTotals(entries, excludeId);
  const activeEnd = activeTimer?.ended_at
    ? Math.min(now, Date.parse(activeTimer.ended_at))
    : now;
  const activeSegments =
    activeTimer && activeEnd > Date.parse(activeTimer.started_at)
      ? splitInterval(activeTimer.started_at, activeEnd)
      : [];
  for (const segment of splitInterval(start, end)) {
    const activeToday = activeSegments
      .filter((active) => active.date === segment.date)
      .reduce((sum, active) => sum + active.duration_ms, 0);
    if (
      (totals.get(segment.date) || 0) + activeToday + segment.duration_ms >
      MAX_DAILY_MS
    ) {
      throw new Error(
        `This entry would exceed the 16-hour limit for ${segment.date}.`,
      );
    }
  }
  return { start, end };
}

export function validateDataset(data, now = Date.now()) {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Backup data must be an object.");
  }
  if (data.version !== 1)
    throw new Error("This backup version is not supported.");
  const { profile, settings, tasks, entries, active_timer: activeTimer } = data;
  if (
    !profile ||
    typeof profile !== "object" ||
    Array.isArray(profile) ||
    !settings ||
    typeof settings !== "object" ||
    Array.isArray(settings) ||
    !Array.isArray(tasks) ||
    !Array.isArray(entries) ||
    !(activeTimer === null || (activeTimer && typeof activeTimer === "object"))
  ) {
    throw new Error(
      "Backup data is missing required profile, settings, task, entry, or timer fields.",
    );
  }
  if (
    typeof profile.full_name !== "string" ||
    typeof profile.company_name !== "string"
  ) {
    throw new Error("The backup profile has invalid name or company values.");
  }
  if (
    !(
      settings.target_hours === null ||
      (Number.isFinite(settings.target_hours) &&
        settings.target_hours > 0 &&
        settings.target_hours <= 100000)
    )
  ) {
    throw new Error("The backup placement-hour target is invalid.");
  }
  if (!["light", "dark"].includes(settings.theme))
    throw new Error("The backup theme is invalid.");

  const taskIds = new Set();
  for (const task of tasks) {
    if (
      !task ||
      typeof task.id !== "string" ||
      !task.id ||
      typeof task.name !== "string" ||
      !task.name.trim() ||
      task.name.length > 100 ||
      typeof task.notes !== "string" ||
      task.notes.length > 500 ||
      typeof task.created_at !== "string" ||
      !Number.isFinite(Date.parse(task.created_at)) ||
      typeof task.updated_at !== "string" ||
      !Number.isFinite(Date.parse(task.updated_at))
    ) {
      throw new Error("A task in the backup is invalid.");
    }
    if (taskIds.has(task.id))
      throw new Error("The backup contains duplicate task IDs.");
    taskIds.add(task.id);
  }

  const entryIds = new Set();
  for (const entry of entries) {
    if (
      !entry ||
      typeof entry.id !== "string" ||
      !entry.id ||
      !taskIds.has(entry.task_id) ||
      !["timer", "manual"].includes(entry.source) ||
      typeof entry.notes !== "string" ||
      entry.notes.length > 1000 ||
      typeof entry.created_at !== "string" ||
      !Number.isFinite(Date.parse(entry.created_at)) ||
      typeof entry.updated_at !== "string" ||
      !Number.isFinite(Date.parse(entry.updated_at))
    ) {
      throw new Error("A time entry in the backup is invalid.");
    }
    if (entryIds.has(entry.id))
      throw new Error("The backup contains duplicate entry IDs.");
    entryIds.add(entry.id);
    if (entry.started_at === undefined || entry.ended_at === undefined) {
      throw new Error("A backup entry is missing its start or end time.");
    }
    validateEntry(entry, {
      entries,
      now,
      excludeId: entry.id,
    });
  }

  if (activeTimer) {
    const start = Date.parse(activeTimer.started_at);
    if (
      !taskIds.has(activeTimer.task_id) ||
      !Number.isFinite(start) ||
      start > now
    ) {
      throw new Error("The active timer in the backup is invalid.");
    }
    for (const entry of entries) {
      if (
        intervalOverlaps(
          start,
          Math.max(start, now),
          Date.parse(entry.started_at),
          Date.parse(entry.ended_at),
        )
      ) {
        throw new Error("The active timer overlaps another saved activity.");
      }
    }
  }
  return true;
}
