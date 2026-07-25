# Desktop App Automatic Updates (GitHub Releases)

Silent background updates for Ninja Era Messenger (and future desktop apps).

Installers are **hosted on GitHub Releases**. The Ninja Era backend stores **metadata only** and never uploads, proxies, or streams update packages.

## Architecture

| Piece | Role |
|-------|------|
| Admin → **Desktop App Updates** | Super Admin enters version + GitHub asset URL |
| `GET /api/desktop-releases/latest` | Metadata JSON (version, GitHub URL, checksum, notes) |
| Desktop client | Downloads installer **directly from GitHub**, verifies, installs, restarts |
| GitHub Releases | Binary hosting (Setup.exe / assets) |

Current app id: `messenger`  
Current channel: `stable`

## How to publish a new release

1. Build Windows installers (`npm run desktop:dist:win` in `frontend/`):
   - **`NinjaEraMessenger-Setup-<version>.exe`** — NSIS interactive installer (user downloads / first install; cancel locked once copy starts)
   - **`NinjaEraMessenger-Squirrel-Setup-<version>.exe`** — Squirrel silent installer (**use this URL for auto-updates**)
2. Create a GitHub Release (e.g. tag `v1.4.2`) and upload the **Squirrel** Setup artifact for updates:
   - `NinjaEraMessenger-Squirrel-Setup-1.4.2.exe`
3. Copy the **asset download URL**, shaped like:
   ```
   https://github.com/<org>/<repo>/releases/download/v1.4.2/NinjaEraMessenger-Squirrel-Setup-1.4.2.exe
   ```
4. Sign in as **Super Admin** → Admin → **Desktop App Updates**.
5. Fill in:
   - Application (Messenger)
   - Channel (`stable` / `beta` / `development`)
   - Version (`1.4.2`)
   - GitHub Release URL
   - Release notes
   - Publish date
   - Optional SHA-256 checksum
   - Optional minimum supported version
6. Save and **Publish** (or enable publish-on-create).

Clients already running a packaged production build will:

1. Query `/api/desktop-releases/latest?appId=messenger&channel=stable`
2. If a newer version exists, download the installer from the GitHub URL
3. Verify SHA-256 when provided
4. Install silently and restart when not in a call / screen share

## Backend responsibilities

Store and return only:

- `app_id`, `version`, `channel`
- `github_release_url`
- `release_notes`, `min_supported_version`
- `sha256` (optional checksum)
- `published` / `published_at`

**Do not** store installer binaries. **Do not** proxy GitHub downloads.

## URL validation

On save, the API checks:

- HTTPS only
- Host is `github.com` or `objects.githubusercontent.com`
- Path looks like a Releases asset (`/releases/download/...`) unless it is a GitHub object URL

The file is **not** downloaded during validation.

## Client verification & safety

- Rejects non-GitHub final redirect hosts
- Optional SHA-256 mismatch aborts install
- No downgrades (remote must be newer than `app.getVersion()`)
- Install delayed while in call or screen sharing
- Silent OS notifications only (no confirmation dialogs)

## Channels & future apps

Channels: `stable`, `beta`, `development`.

For another desktop app (Launcher, Editor, …):

1. Ensure the app id exists in the app registry (labels only).
2. Publish metadata with that `appId` and its own GitHub asset URL.
3. Point that app’s client `UPDATE_APP_ID` / `UPDATE_CHANNEL` at the matching feed.

No schema redesign is required for new applications.

## Key files

- `frontend/electron/main/updater.ts` — metadata check + GitHub download + silent install
- `backend/src/routes/desktopUpdates.ts` — public latest metadata
- `backend/src/routes/adminDesktopReleases.ts` — Super Admin CRUD
- `frontend/src/features/admin/AdminDesktopUpdates.tsx` — Admin UI
- `docs/desktop-auto-updates.md` — this document

