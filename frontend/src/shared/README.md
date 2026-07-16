# Shared

Cross-cutting frontend utilities used by multiple features.

| File | Role |
|------|------|
| `routing.ts` | Hash/path ↔ page id |
| `branding.ts` | Official logo asset URL + brand name constants |
| `BrandLogo.tsx` | Shared `<img>` for `logo.png` across the app |
| `socialLinks.ts` | Footer social URLs |
| `scrollToSection.ts` | Landing-page section scrolling |
| `countryIso.ts` | ISO country codes + display/mask helpers |
| `perf.ts` | App-level performance marks |

Shell-level API (`@/app/api`), realtime (`@/app/realtime`), and theme UI (`@/app/shared`) stay under `app/` because nearly every feature depends on them. Prefer adding new reusable helpers here instead of duplicating inside features.
