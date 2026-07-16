# Frontend source layout

```
src/
  app/           Shell: App.tsx, api.ts, realtime.ts, shared.tsx, components/ui
  shared/        Cross-feature utilities (routing, countryIso, socialLinks, …)
  features/      Domain features (messages, calling, admin, auth, landing, …)
  styles/        Global CSS
  imports/       Static assets
```

See each `features/*/README.md` and `.cursor/rules/frontend-architecture.mdc`.
