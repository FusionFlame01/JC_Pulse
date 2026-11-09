import { validateDataset } from "./validation.js";

export const STORAGE_KEY = "jc-pulse-data";
export const RECOVERY_KEY = "jc-pulse-corrupt-recovery";
export const BACKUP_SCHEMA = "jc-pulse-backup";
export const DATA_VERSION = 1;

let recoveryNotice = "";

export function createInitialState() {
  return {
    version: DATA_VERSION,
    profile: { full_name: "", company_name: "" },
    settings: { target_hours: null, theme: "light" },
    tasks: [],
    entries: [],
    active_timer: null,
  };
}

function isValidState(data) {
  try {
    validateDataset(data, Date.now());
    return true;
  } catch {
    return false;
  }
}

function storage() {
  try {
    if (!globalThis.localStorage) throw new Error("Browser storage is not available.");
    return globalThis.localStorage;
  } catch (error) {
    throw new Error(`JC Pulse needs browser localStorage to save your records: ${error.message}`);
  }
}

export function getRecoveryNotice() {
  return recoveryNotice;
}

export function loadState() {
  const store = storage();
  let raw;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch (error) {
    throw new Error(`JC Pulse could not read local data: ${error.message}`);
  }
  if (raw === null) return createInitialState();

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return recoverCorruptedState(store, raw, "The saved data was not valid JSON.");
  }
  if (!isValidState(parsed)) {
    return recoverCorruptedState(store, raw, "The saved data did not match the supported JC Pulse format.");
  }
  return parsed;
}

function recoverCorruptedState(store, raw, reason) {
  try {
    store.setItem(RECOVERY_KEY, raw);
    const fresh = createInitialState();
    store.setItem(STORAGE_KEY, JSON.stringify(fresh));
    recoveryNotice = `${reason} A copy was kept in browser storage under “${RECOVERY_KEY}”; the app opened with an empty workspace.`;
    return fresh;
  } catch (error) {
    throw new Error(`${reason} JC Pulse could not preserve the damaged data safely: ${error.message}`);
  }
}

export function saveState(data) {
  validateDataset(data, Date.now());
  try {
    storage().setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (error) {
    throw new Error(`JC Pulse could not save your data. Check browser storage availability: ${error.message}`);
  }
  return data;
}

export function updateState(mutator) {
  const current = loadState();
  const next = structuredClone(current);
  mutator(next);
  saveState(next);
  return next;
}

export function exportBackup(data = loadState()) {
  return {
    schema: BACKUP_SCHEMA,
    version: DATA_VERSION,
    exported_at: new Date().toISOString(),
    data,
  };
}

export function parseBackup(text, now = Date.now()) {
  let backup;
  try {
    backup = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (!backup || backup.schema !== BACKUP_SCHEMA || backup.version !== DATA_VERSION) {
    throw new Error("This is not a supported JC Pulse backup.");
  }
  validateDataset(backup.data, now);
  return backup.data;
}

export function mergeBackup(current, incoming, now = Date.now()) {
  const merged = structuredClone(current);
  const existingTaskIds = new Set(merged.tasks.map((task) => task.id));
  const incomingTaskIds = new Set(incoming.tasks.map((task) => task.id));
  const addedTaskIds = new Set();

  for (const task of incoming.tasks) {
    if (!existingTaskIds.has(task.id)) {
      merged.tasks.push(structuredClone(task));
      existingTaskIds.add(task.id);
      addedTaskIds.add(task.id);
    }
  }
  const existingEntryIds = new Set(merged.entries.map((entry) => entry.id));
  for (const entry of incoming.entries) {
    if (!existingEntryIds.has(entry.id) && existingTaskIds.has(entry.task_id)
      && (addedTaskIds.has(entry.task_id) || incomingTaskIds.has(entry.task_id))) {
      merged.entries.push(structuredClone(entry));
      existingEntryIds.add(entry.id);
    }
  }
  let timerSkipped = false;
  if (incoming.active_timer) {
    if (!merged.active_timer) {
      merged.active_timer = structuredClone(incoming.active_timer);
    } else if (merged.active_timer.task_id !== incoming.active_timer.task_id
      || merged.active_timer.started_at !== incoming.active_timer.started_at) {
      timerSkipped = true;
    }
  }
  try {
    validateDataset(merged, now);
  } catch (error) {
    throw new Error(`These records cannot be merged without creating invalid or overlapping time: ${error.message}`);
  }
  return { data: merged, timerSkipped };
}

export function clearAllData() {
  try {
    const store = storage();
    store.removeItem(STORAGE_KEY);
    store.removeItem(RECOVERY_KEY);
    recoveryNotice = "";
  } catch (error) {
    throw new Error(`JC Pulse could not clear its saved data: ${error.message}`);
  }
}
