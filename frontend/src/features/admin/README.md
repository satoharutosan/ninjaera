# Admin

Moderator/admin console: users, contacts, channels, notifications, resources, activity logs, messaging history, database console.

## Entry points

- `AdminPage.tsx` — section shell (fixed sidebar + single scrolling main panel)
- `AdminMessagingHistory.tsx` — read-only DM history among other users + delete
- `AdminDatabaseConsole.tsx` — table explorer, paginated CRUD, backup/restore

## Important files

| Path | Role |
|------|------|
| `adminMeta.ts` | Section nav, chart colors, empty dashboard stats |
| `components/AdminChrome.tsx` | Shared admin UI chrome (stat cards, sections, location cells) |

## Extending

- Prefer adding a new section id in `adminMeta.ts` plus UI in `AdminPage`, or extract a section file only when a section exceeds ~600 lines.
- Database console APIs live under `/api/admin/database/*` (admin-only) and use identifier allowlisting + sensitive-column masking.
- Reuse message media helpers from `features/messages` rather than copying bubble UI.
- All admin HTTP goes through `api.admin.*` in `@/app/api`.
