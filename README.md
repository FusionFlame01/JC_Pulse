# JC Pulse

JC Pulse is a lightweight placement-hours tracker for students, built with
plain HTML, CSS, and vanilla JavaScript. It is a static website: there is no
application server, database, login, account, or cloud synchronization.

## Run locally

Serve the project folder with any static web server. For example, with Python:

```powershell
python -m http.server 4173
```

Then open `http://localhost:4173`. Serving the folder is necessary because the
app loads JavaScript modules; opening `index.html` directly as a `file://` URL
is not supported.

## Deploy to Vercel

1. Push the project to a GitHub repository.
2. Import that repository in Vercel.
3. Keep the framework preset as **Other** and leave the build command and output
   directory empty. The root `index.html` and `vercel.json` configure a static
   deployment.

No environment variables, API routes, database, or build step are needed.

## Track hours and prepare evidence

- Create placement tasks, then start and stop one task timer at a time. Timer
  state is stored as a start timestamp, so a page refresh does not reset it.
- Add past time manually, edit or delete saved entries, and include notes.
- Time is allocated to local calendar days. Sessions crossing midnight are
  split for daily totals and reports. Saved sessions cannot overlap, and total
  recorded placement time is capped at 16 hours per calendar day across tasks.
- Overview shows today and this week's progress. An optional placement-hour
  target can be set in Profile.
- Reports support daily, Monday-to-Sunday weekly, monthly, and custom date
  ranges. Export a period as structured JSON or use **Print / Save PDF** and
  your browser's print dialog.
- A full JSON backup includes the profile, settings, tasks, entries, and any
  active timer. Restore replaces current records after confirmation; merge adds
  tasks and entries whose stable IDs are not already present, keeps your current
  profile and settings, and keeps the existing timer if there is a conflict.

## Important data notice

All records are stored in this browser's `localStorage` for this site origin.
They are not uploaded or synchronized. Clearing site/browser data, using a
different browser profile, or moving to another device can make records
unavailable. Download regular full JSON backups and store them somewhere safe.

## Development checks

Install Node.js, then run:

```powershell
npm test
```

The test suite covers browser storage validation, timer lifecycle, midnight
allocation, daily caps, session overlap, backup handling, and report totals.

## Interface direction

JC Pulse uses independent design references rather than copying their brands or
screens: Clockify informs the separate tracker/history/report workflows; Toggl
Track informs the prominent clock; Linear informs compact navigation and task
hierarchy; Notion informs calm, structured content; and Harvest informs the
timesheet and evidence-ready report. The resulting interface keeps a distinct
green identity, compact information hierarchy, and table-first layouts.
