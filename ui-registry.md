# UI Registry

### JC Pulse Workspace

Files: `index.html`, `css/styles.css`
Last updated: 2026-11-09

| Property         | Class / token                                                       |
| ---------------- | ------------------------------------------------------------------- |
| Background       | `--page: #f7f8f6`; surfaces use `--surface: #ffffff`                |
| Border           | `1px solid var(--line)`; `--line-strong` for control boundaries     |
| Border radius    | Controls `--radius-control: 6px`; sections `--radius-panel: 9px`    |
| Text — primary   | `--ink: #202c28`                                                    |
| Text — secondary | `--ink-soft: #44524c`; `--muted: #78837d`                            |
| Spacing          | `--space-1` through `--space-7` (4px to 48px)                      |
| Hover state      | Brand uses `--brand-hover`; secondary controls use `--surface-muted` |
| Shadow           | Restrained toast shadow; no decorative card shadows                 |
| Accent usage     | `--brand: #28745e`; `--brand-soft: #e7f1eb`; running state uses `--running` |
| Dark theme       | Same tokens switch under `:root[data-theme="dark"]`                  |
| Forms            | Compact labeled controls; optional notes use the same neutral field surfaces |
| Evidence         | Report preview uses metadata definition rows and a print-friendly table |
| Browser data     | Persistent local-data notice uses the brand-soft surface with a semantic left rule |
| Status           | Use concise state text; omit decorative pulsing/status dots                  |

**Pattern notes:**
Use semantic CSS custom properties rather than one-off colors. The workspace
uses compact neutral surfaces, fine dividers, and table-first data instead of
repeated statistic cards. The timer is the central action; brand green marks
primary controls and active time. Keep status meaning consistent, make hover
and focus states visible, and use the same tokens in both themes and on mobile.
Progress is shown as a slim native progress bar only when a student has opted
into a placement target. Backup and destructive controls are grouped on Profile
and separated from everyday tracking actions.
Timer state remains available as plain text in the Tracker; avoid decorative
status dots or redundant "saved locally" header indicators.
