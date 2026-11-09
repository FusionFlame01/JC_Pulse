import {
  clearAllData,
  exportBackup,
  getRecoveryNotice,
  loadState,
  mergeBackup,
  parseBackup,
  saveState,
} from "./storage.js";
import {
  createTask,
  deleteEntry,
  listEntries,
  renameTask,
  saveEntry,
  getTodayTotalsByTask,
} from "./entries.js";
import { cancelTimer, getTimerStatus, startTimer, stopTimer } from "./timer.js";
import { buildReport, progressSummary } from "./reports.js";
import { localDateKey } from "./validation.js";

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const dateToday = localDateKey();
let activeView = "dashboard";
let editingTaskId = null;
let editingEntryId = null;
let importedData = null;
let historyOptions = { from: dateToday, to: dateToday, task: "", search: "" };

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function formatDuration(milliseconds) {
  const totalMinutes = Math.floor(Math.max(0, milliseconds) / 60000);
  return `${Math.floor(totalMinutes / 60)}h ${String(totalMinutes % 60).padStart(2, "0")}m`;
}

function formatClock(milliseconds) {
  const totalSeconds = Math.floor(Math.max(0, milliseconds) / 1000);
  return [Math.floor(totalSeconds / 3600), Math.floor((totalSeconds % 3600) / 60), totalSeconds % 60]
    .map((part) => String(part).padStart(2, "0")).join(":");
}

function formatTime(value) {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDate(value) {
  return new Date(value).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function localDateTime(date, time) {
  const value = new Date(`${date}T${time}`);
  if (!Number.isFinite(value.getTime())) throw new Error("Choose a valid date and time.");
  return value;
}

function notify(message, type = "success") {
  const box = $("#status-message");
  box.textContent = message;
  box.dataset.type = type;
  box.classList.add("is-visible");
  window.clearTimeout(notify.timeout);
  notify.timeout = window.setTimeout(() => box.classList.remove("is-visible"), 5000);
}

function withError(action) {
  try {
    action();
  } catch (error) {
    notify(error instanceof Error ? error.message : "Something went wrong.", "error");
  }
}

function setView(view) {
  activeView = view;
  $$(".view").forEach((section) => { section.hidden = section.id !== `${view}-view`; });
  $$(".nav-link").forEach((button) => {
    const active = button.dataset.view === view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  if (view === "history") renderHistory();
  if (view === "reports") renderReport();
}

function taskOptions(tasks, selected = "") {
  return `<option value="">Choose a task</option>${tasks.map((task) =>
    `<option value="${escapeHtml(task.id)}" ${task.id === selected ? "selected" : ""}>${escapeHtml(task.name)}</option>`
  ).join("")}`;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const label = theme === "light" ? "Switch to dark theme" : "Switch to light theme";
  $("#theme-toggle").setAttribute("aria-label", label);
  $("#theme-toggle").title = label;
  $$("[data-theme-choice]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.themeChoice === theme));
  });
}

function renderTaskRows(state, totals) {
  const now = Date.now();
  const totalByTask = new Map();
  for (const entry of state.entries) {
    totalByTask.set(entry.task_id, (totalByTask.get(entry.task_id) || 0)
      + Date.parse(entry.ended_at) - Date.parse(entry.started_at));
  }
  if (state.active_timer) {
    const elapsed = Math.max(0, now - Date.parse(state.active_timer.started_at));
    totalByTask.set(state.active_timer.task_id, (totalByTask.get(state.active_timer.task_id) || 0) + elapsed);
  }

  $("#dashboard-task-list").innerHTML = state.tasks.map((task) => `
    <tr>
      <td class="task-cell"><strong class="task-name">${escapeHtml(task.name)}</strong><span class="active-label" ${state.active_timer?.task_id === task.id ? "" : "hidden"}>Tracking</span>
        ${task.notes ? `<span class="task-notes">${escapeHtml(task.notes)}</span>` : ""}
      </td>
      <td>${formatDuration(totals.get(task.id) || 0)}</td>
      <td>${formatDuration(totalByTask.get(task.id) || 0)}</td>
      <td class="task-actions"><button class="text-button task-rename" type="button" data-edit-task="${escapeHtml(task.id)}">Edit</button><button class="button button-small task-start" type="button" data-start-task="${escapeHtml(task.id)}">Start</button></td>
    </tr>`).join("");
  $("#empty-tasks").hidden = state.tasks.length > 0;
  $("#tracker-task").innerHTML = taskOptions(state.tasks, state.active_timer?.task_id || "");
  $("#entry-task").innerHTML = taskOptions(state.tasks);
  $("#manual-task").innerHTML = taskOptions(state.tasks);
  $("#tracker-task-list").innerHTML = state.tasks.length
    ? state.tasks.map((task) => `<button class="quick-task" type="button" data-start-task="${escapeHtml(task.id)}"><strong>${escapeHtml(task.name)}</strong><span>${formatDuration(totals.get(task.id) || 0)} today</span></button>`).join("")
    : `<p class="empty-inline">Add a task from Overview to start tracking.</p>`;
}

function renderRecent() {
  const today = localDateKey();
  const entries = listEntries({ from: today, to: today }).slice(0, 5);
  $("#recent-entries").innerHTML = entries.map((entry) => `
    <div class="activity-row">
      <span class="activity-mark" aria-hidden="true"></span>
      <div class="activity-main"><strong>${escapeHtml(entry.task_name)}</strong><span>${formatTime(entry.started_at)} – ${formatTime(entry.ended_at)}${entry.running ? " · In progress" : ""}</span></div>
      <span class="activity-duration">${formatDuration(Date.parse(entry.ended_at) - Date.parse(entry.started_at))}</span>
    </div>`).join("");
  $("#empty-entries").hidden = entries.length > 0;
}

function renderDashboard(state) {
  const progress = progressSummary();
  const totals = getTodayTotalsByTask();
  const now = new Date();
  $("#today-label").textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  $("#greeting").textContent = state.profile.full_name
    ? `Your placement, ${state.profile.full_name.split(/\s+/)[0]}.`
    : "Your placement, in focus.";
  $("#profile-prompt").hidden = Boolean(state.profile.full_name && state.profile.company_name);
  $("#today-total").textContent = formatDuration(progress.today_ms);
  $("#week-total").textContent = formatDuration(progress.week_ms);
  $("#week-range").textContent = `· ${formatDate(`${progress.week_range.start}T12:00:00`)} – ${formatDate(`${progress.week_range.end}T12:00:00`)}`;
  $("#today-entry-count").textContent = `${progress.today_entries} ${progress.today_entries === 1 ? "entry" : "entries"}`;
  $("#target-progress").hidden = state.settings.target_hours === null;
  if (state.settings.target_hours !== null) {
    const percentage = Math.min(100, (progress.total_ms / 3600000 / state.settings.target_hours) * 100);
    $("#target-progress-bar").value = percentage;
    $("#target-progress-label").textContent = `${formatDuration(progress.total_ms)} of ${state.settings.target_hours} hours · ${Math.floor(percentage)}%`;
  }
  renderTaskRows(state, totals);
  renderRecent();
}

function renderTimer(state) {
  const status = getTimerStatus();
  const task = status.timer;
  $("#tracker-clock").textContent = formatClock(status.elapsed_ms);
  $("#tracker-active-task").textContent = task?.task_name || "No task selected";
  $("#dashboard-active-task").textContent = task?.task_name || "No active task";
  $("#dashboard-timer").textContent = task ? "Timer is running" : "Start whenever you’re ready";
  $("#tracker-start").disabled = Boolean(task) || state.tasks.length === 0;
  $("#tracker-stop").disabled = !task;
  $("#tracker-cancel").hidden = !task;
  $("#tracker-state").textContent = task
    ? `Tracking since ${formatTime(task.started_at)}`
    : "Ready when you are";
  $("#tracker-today-total").textContent = formatDuration(progressSummary().today_ms);
  if (status.reachedLimit) notify("The 16-hour daily limit was reached. The timer was stopped and saved.");
}

function renderHistory() {
  const state = loadState();
  const task = $("#history-task").value;
  const search = $("#history-search").value.trim().toLowerCase();
  const entries = listEntries({ from: historyOptions.from, to: historyOptions.to })
    .filter((entry) => (!task || entry.task_id === task)
      && (!search || entry.task_name.toLowerCase().includes(search) || entry.notes.toLowerCase().includes(search)));
  $("#history-task").innerHTML = `<option value="">All tasks</option>${state.tasks.map((item) =>
    `<option value="${escapeHtml(item.id)}" ${task === item.id ? "selected" : ""}>${escapeHtml(item.name)}</option>`
  ).join("")}`;
  const total = entries.reduce((sum, entry) => sum + Date.parse(entry.ended_at) - Date.parse(entry.started_at), 0);
  $("#history-result-count").textContent = `${entries.length} ${entries.length === 1 ? "entry" : "entries"}`;
  $("#history-total").textContent = formatDuration(total);
  $("#history-entries").innerHTML = entries.map((entry) => `
    <tr>
      <td>${formatDate(entry.started_at)}</td><td><strong>${escapeHtml(entry.task_name)}</strong>${entry.notes ? `<span class="table-note">${escapeHtml(entry.notes)}</span>` : ""}</td>
      <td>${formatTime(entry.started_at)}</td><td>${formatTime(entry.ended_at)}${new Date(entry.ended_at).getDate() !== new Date(entry.started_at).getDate() ? " +" : ""}</td>
      <td>${formatDuration(Date.parse(entry.ended_at) - Date.parse(entry.started_at))}${entry.running ? " · running" : ""}</td>
      <td class="entry-actions">${entry.running ? "" : `<button class="text-button" type="button" data-edit-entry="${escapeHtml(entry.id)}">Edit</button><button class="text-button danger-text" type="button" data-delete-entry="${escapeHtml(entry.id)}">Delete</button>`}</td>
    </tr>`).join("");
  $("#history-empty").hidden = entries.length > 0;
}

function renderReport() {
  const period = $("#report-period").value;
  const custom = period === "custom";
  $("#report-date").closest(".field-group").hidden = custom;
  $("#report-from-field").hidden = !custom;
  $("#report-to-field").hidden = !custom;
  try {
    const report = buildReport({
      period,
      date: $("#report-date").value || localDateKey(),
      from: $("#report-from").value,
      to: $("#report-to").value,
    });
    const entries = report.entries.map((entry) => `
      <tr><td>${escapeHtml(entry.date)}</td><td>${escapeHtml(entry.task_name)}</td><td>${formatTime(entry.started_at)}</td><td>${formatTime(entry.ended_at)}</td><td>${formatDuration(entry.duration_ms)}</td><td>${escapeHtml(entry.notes || "")}</td></tr>`).join("");
    $("#report-content").innerHTML = `
      <article class="report-sheet">
        <header class="report-header"><div><p class="eyebrow">JC PULSE · PLACEMENT EVIDENCE</p><h2>${period === "custom" ? "Custom report" : `${period[0].toUpperCase()}${period.slice(1)} report`}</h2><p>${escapeHtml(report.range.start)} – ${escapeHtml(report.range.end)}</p></div><strong>${formatDuration(report.total_ms)}</strong></header>
        <dl class="report-identity"><div><dt>Student</dt><dd>${escapeHtml(report.profile.full_name || "Not provided")}</dd></div><div><dt>Placement company</dt><dd>${escapeHtml(report.profile.company_name || "Not provided")}</dd></div><div><dt>Timezone</dt><dd>${escapeHtml(report.timezone)}</dd></div></dl>
        <div class="table-wrap"><table class="data-table report-table"><thead><tr><th>Date</th><th>Task</th><th>Start</th><th>End</th><th>Duration</th><th>Notes</th></tr></thead><tbody>${entries}</tbody></table>
        ${report.entries.length ? "" : `<div class="empty-state"><strong>No time recorded for this period</strong><p>Choose another reporting period or track a task.</p></div>`}</div>
        <footer class="report-footer">Generated ${escapeHtml(new Date(report.generated_at).toLocaleString())} · JC Pulse placement-hours record</footer>
      </article>`;
  } catch (error) {
    $("#report-content").innerHTML = `<p class="inline-error">${escapeHtml(error.message)}</p>`;
  }
}

function render() {
  const settledTimer = getTimerStatus();
  if (settledTimer.reachedLimit) {
    notify("The 16-hour daily limit was reached. The timer was stopped and saved.");
  }
  const state = loadState();
  applyTheme(state.settings.theme);
  $("#full-name").value = state.profile.full_name;
  $("#company-name").value = state.profile.company_name;
  $("#target-hours").value = state.settings.target_hours ?? "";
  renderDashboard(state);
  renderTimer(state);
  if (activeView === "history") renderHistory();
  if (activeView === "reports") renderReport();
  const notice = getRecoveryNotice();
  if (notice) notify(notice, "error");
}

function updateHistoryRange() {
  const now = new Date();
  const today = localDateKey(now);
  const preset = $("#history-period").value;
  if (preset === "week") {
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7), 12);
    historyOptions.from = localDateKey(monday);
    historyOptions.to = today;
  } else if (preset === "month") {
    historyOptions.from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
    historyOptions.to = today;
  } else {
    historyOptions.from = $("#history-from").value;
    historyOptions.to = $("#history-to").value;
  }
}

function openEntryDialog(entry = null) {
  const editing = Boolean(entry);
  editingEntryId = entry?.id || null;
  $("#entry-dialog-title").textContent = editing ? "Edit time entry" : "Add a time entry";
  const start = entry ? new Date(entry.started_at) : new Date();
  const end = entry ? new Date(entry.ended_at) : new Date(Date.now() - 60000);
  $("#entry-task").value = entry?.task_id || "";
  $("#entry-date").value = localDateKey(start);
  $("#entry-start").value = `${String(start.getHours()).padStart(2, "0")}:${String(start.getMinutes()).padStart(2, "0")}`;
  $("#entry-end").value = `${String(end.getHours()).padStart(2, "0")}:${String(end.getMinutes()).padStart(2, "0")}`;
  $("#entry-notes").value = entry?.notes || "";
  $("#entry-dialog").showModal();
}

function saveEntryFromDialog(form) {
  let start = localDateTime($("#entry-date").value, $("#entry-start").value);
  let end = localDateTime($("#entry-date").value, $("#entry-end").value);
  if (end <= start) end.setDate(end.getDate() + 1);
  saveEntry({
    id: editingEntryId,
    task_id: $("#entry-task").value,
    started_at: start.toISOString(),
    ended_at: end.toISOString(),
    notes: $("#entry-notes").value,
  });
  form.closest("dialog").close();
  notify(editingEntryId ? "Time entry updated." : "Time entry saved.");
  editingEntryId = null;
  render();
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#new-task-form").addEventListener("submit", (event) => {
  event.preventDefault();
  withError(() => {
    createTask($("#new-task-name").value, $("#new-task-notes").value);
    event.currentTarget.reset();
    notify("Task added.");
    render();
  });
});

$("#profile-form").addEventListener("submit", (event) => {
  event.preventDefault();
  withError(() => {
    const state = loadState();
    state.profile = {
      full_name: $("#full-name").value.trim(),
      company_name: $("#company-name").value.trim(),
    };
    const target = $("#target-hours").value.trim();
    state.settings.target_hours = target ? Number(target) : null;
    saveState(state);
    notify("Profile saved.");
    render();
  });
});

$("#theme-toggle").addEventListener("click", () => withError(() => {
  const state = loadState();
  state.settings.theme = state.settings.theme === "light" ? "dark" : "light";
  saveState(state);
  render();
}));

$$("[data-theme-choice]").forEach((button) => button.addEventListener("click", () => withError(() => {
  const state = loadState();
  state.settings.theme = button.dataset.themeChoice;
  saveState(state);
  render();
})));

$("#tracker-start").addEventListener("click", () => withError(() => {
  startTimer($("#tracker-task").value);
  notify("Timer started.");
  render();
}));

$("#tracker-stop").addEventListener("click", () => withError(() => {
  const result = stopTimer();
  notify(result.reachedLimit ? "Daily limit reached; time was saved up to the 16-hour maximum." : "Time saved.");
  render();
}));

$("#tracker-cancel").addEventListener("click", () => withError(() => {
  if (window.confirm("Cancel this timer without saving its time?")) {
    cancelTimer();
    notify("Timer canceled. No time entry was saved.");
    render();
  }
}));

$("#manual-entry-open").addEventListener("click", () => {
  const state = loadState();
  if (!state.tasks.length) return notify("Add a task before entering time.", "error");
  $("#manual-date").value = localDateKey();
  $("#manual-start").value = "09:00";
  $("#manual-end").value = "10:00";
  $("#manual-notes").value = "";
  $("#manual-task").value = "";
  $("#manual-dialog").showModal();
});

$("#manual-entry-form").addEventListener("submit", (event) => {
  event.preventDefault();
  withError(() => {
    const date = $("#manual-date").value;
    const start = localDateTime(date, $("#manual-start").value);
    const end = localDateTime(date, $("#manual-end").value);
    if (end <= start) end.setDate(end.getDate() + 1);
    saveEntry({
      task_id: $("#manual-task").value,
      started_at: start.toISOString(),
      ended_at: end.toISOString(),
      notes: $("#manual-notes").value,
    });
    $("#manual-dialog").close();
    notify("Manual time entry saved.");
    render();
  });
});

$("#history-filters").addEventListener("submit", (event) => {
  event.preventDefault();
  updateHistoryRange();
  historyOptions.task = $("#history-task").value;
  historyOptions.search = $("#history-search").value;
  if (historyOptions.from > historyOptions.to) return notify("The from date must be on or before the to date.", "error");
  renderHistory();
});
$("#history-period").addEventListener("change", () => {
  updateHistoryRange();
  $("#history-from").value = historyOptions.from;
  $("#history-to").value = historyOptions.to;
});

$("#report-period").addEventListener("change", renderReport);
$("#report-filters").addEventListener("submit", (event) => { event.preventDefault(); renderReport(); });
$("#report-date").value = localDateKey();
$("#report-from").value = localDateKey();
$("#report-to").value = localDateKey();
$("#report-json").addEventListener("click", () => withError(() => {
  const period = $("#report-period").value;
  const report = buildReport({
    period,
    date: $("#report-date").value,
    from: $("#report-from").value,
    to: $("#report-to").value,
  });
  downloadJson(report, `jc-pulse-${period}-${report.range.start}-to-${report.range.end}.json`);
  notify("Report JSON download started.");
}));
$("#report-pdf").addEventListener("click", () => window.print());

$("#backup-export").addEventListener("click", () => withError(() => {
  const backup = exportBackup();
  downloadJson(backup, `jc-pulse-backup-${localDateKey()}.json`);
  notify("Full backup download started.");
}));
$("#backup-file").addEventListener("change", async (event) => {
  importedData = null;
  $("#backup-restore").disabled = true;
  $("#backup-merge").disabled = true;
  const file = event.currentTarget.files?.[0];
  if (!file) return;
  try {
    importedData = parseBackup(await file.text());
    $("#backup-restore").disabled = false;
    $("#backup-merge").disabled = false;
    notify("Backup validated. Choose restore or merge.");
  } catch (error) {
    notify(error.message, "error");
  }
});
$("#backup-restore").addEventListener("click", () => withError(() => {
  if (!importedData) throw new Error("Choose a valid backup file first.");
  if (!window.confirm("Restore replaces all current profile, task, entry, and timer data. Continue?")) return;
  saveState(structuredClone(importedData));
  notify("Backup restored.");
  render();
}));
$("#backup-merge").addEventListener("click", () => withError(() => {
  if (!importedData) throw new Error("Choose a valid backup file first.");
  const result = mergeBackup(loadState(), importedData);
  saveState(result.data);
  notify(result.timerSkipped
    ? "Backup merged. Matching IDs were skipped and the existing timer was kept."
    : "Backup merged. Matching IDs were skipped.");
  render();
}));
$("#clear-data").addEventListener("click", () => withError(() => {
  if (!window.confirm("Permanently clear all JC Pulse data saved in this browser? This cannot be undone. Download a backup first if you need these records.")) return;
  clearAllData();
  importedData = null;
  notify("All browser-local data was cleared.");
  render();
}));

$("#task-edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  withError(() => {
    renameTask(editingTaskId, $("#edit-task-name").value, $("#edit-task-notes").value);
    $("#task-dialog").close();
    notify("Task updated.");
    render();
  });
});
$("#entry-edit-form").addEventListener("submit", (event) => {
  event.preventDefault();
  withError(() => saveEntryFromDialog(event.currentTarget));
});

document.addEventListener("click", (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    setView(viewButton.dataset.view);
  }
  const closeButton = event.target.closest("[data-close-dialog]");
  if (closeButton) $(`#${closeButton.dataset.closeDialog}`).close();
  const taskButton = event.target.closest("[data-edit-task]");
  if (taskButton) withError(() => {
    const task = loadState().tasks.find((candidate) => candidate.id === taskButton.dataset.editTask);
    if (!task) throw new Error("Task not found.");
    editingTaskId = task.id;
    $("#edit-task-name").value = task.name;
    $("#edit-task-notes").value = task.notes;
    $("#task-dialog").showModal();
  });
  const startButton = event.target.closest("[data-start-task]");
  if (startButton) withError(() => {
    $("#tracker-task").value = startButton.dataset.startTask;
    setView("tracker");
    startTimer(startButton.dataset.startTask);
    notify("Timer started.");
    render();
  });
  const editButton = event.target.closest("[data-edit-entry]");
  if (editButton) withError(() => {
    const entry = loadState().entries.find((candidate) => candidate.id === editButton.dataset.editEntry);
    if (!entry) throw new Error("Time entry not found.");
    openEntryDialog(entry);
  });
  const deleteButton = event.target.closest("[data-delete-entry]");
  if (deleteButton) withError(() => {
    if (!window.confirm("Delete this time entry? This cannot be undone.")) return;
    deleteEntry(deleteButton.dataset.deleteEntry);
    notify("Time entry deleted.");
    render();
  });
});

withError(() => {
  const state = loadState();
  $("#full-name").value = state.profile.full_name;
  $("#company-name").value = state.profile.company_name;
  $("#target-hours").value = state.settings.target_hours ?? "";
  $("#history-from").value = historyOptions.from;
  $("#history-to").value = historyOptions.to;
  setView(activeView);
  render();
});

window.setInterval(() => {
  withError(() => {
    const status = getTimerStatus();
    if (status.reachedLimit) {
      notify("The 16-hour daily limit was reached. The timer was stopped and saved.");
      render();
      return;
    }
    $("#tracker-clock").textContent = formatClock(status.elapsed_ms);
    $("#dashboard-timer").textContent = status.timer ? "Timer is running" : "Start whenever you’re ready";
    if (status.timer) $("#dashboard-active-task").textContent = status.timer.task_name;
    const progress = progressSummary();
    $("#today-total").textContent = formatDuration(progress.today_ms);
    $("#week-total").textContent = formatDuration(progress.week_ms);
    $("#today-entry-count").textContent = `${progress.today_entries} ${progress.today_entries === 1 ? "entry" : "entries"}`;
    $("#tracker-today-total").textContent = formatDuration(progress.today_ms);
    const state = loadState();
    if (state.settings.target_hours !== null) {
      const percentage = Math.min(100, (progress.total_ms / 3600000 / state.settings.target_hours) * 100);
      $("#target-progress-bar").value = percentage;
      $("#target-progress-label").textContent = `${formatDuration(progress.total_ms)} of ${state.settings.target_hours} hours · ${Math.floor(percentage)}%`;
    }
  });
}, 1000);
