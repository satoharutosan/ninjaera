# Ninja Era — Dev Manager

A team-specific Chrome extension for managing **Ninja Era** game development. It provides daily progress reporting, PM instruction delivery, sprint tracking, release monitoring, and automated game updates on system reboot.

---

## Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Native Messaging Host](#native-messaging-host)
- [Project Structure](#project-structure)
- [Development](#development)
- [Troubleshooting](#troubleshooting)

---

## Features

### Core (requested)

| Feature | Description |
|---------|-------------|
| **Daily progress report** | Submit summaries, completed work, blockers, and tomorrow's plan to the project manager |
| **PM instructions** | Receive and view instructions from the project manager |
| **Next-stage goals** | Track upcoming development milestones with progress bars |
| **Current dev status** | Sprint progress, task counts, and build status at a glance |
| **Report file upload** | Attach files (`.txt`, `.md`, `.pdf`, `.doc`, `.zip`) when submitting reports |
| **CSV export** | Download full development status as a CSV file |
| **Release version check** | Polls for the latest game release every **1 minute** |
| **Background download** | Downloads new releases silently in the background |
| **Reboot install** | Schedules installation on next system reboot (never while the game is running) |
| **Always-on background** | Service worker runs regardless of which website is open |
| **Instant notifications** | Desktop alerts when new or urgent PM instructions arrive |

### Additional dev management

| Feature | Description |
|---------|-------------|
| **Side panel dashboard** | Full overview with kanban board, sprint burndown, and activity log |
| **Kanban task board** | Drag-and-drop task status updates |
| **Sprint tracking** | Burndown chart, velocity metrics, remaining story points |
| **Milestone tracker** | Alpha / beta / launch milestone progress |
| **Environment status** | Dev, staging, and production health indicators |
| **Blockers & risks** | Dedicated panel for blocked tasks and project risks |
| **Activity log** | Audit trail of syncs, reports, releases, and task changes |
| **Daily report reminder** | Configurable notification to submit end-of-day reports |
| **Report drafts** | Save in-progress reports locally before submitting |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Chrome Extension (MV3)                   │
│                                                             │
│  ┌──────────────┐  ┌──────────┐  ┌─────────────────────┐  │
│  │ Service      │  │ Popup    │  │ Side Panel          │  │
│  │ Worker       │  │ (quick   │  │ (full dashboard)    │  │
│  │              │  │  access) │  │                     │  │
│  │ • Alarms     │  └──────────┘  └─────────────────────┘  │
│  │ • Sync       │                                          │
│  │ • Notify     │  ┌──────────┐  ┌─────────────────────┐  │
│  │ • Release    │  │ Options  │  │ Content Script      │  │
│  └──────┬───────┘  │ (config) │  │ (all URLs)          │  │
│         │          └──────────┘  └─────────────────────┘  │
└─────────┼───────────────────────────────────────────────────┘
          │
          │ Native Messaging (stdio)
          ▼
┌─────────────────────────────────────────────────────────────┐
│              Windows Native Host (Node.js)                  │
│                                                             │
│  • Background file download                                 │
│  • SHA-256 checksum verification                            │
│  • Game process detection (tasklist)                        │
│  • Startup-folder batch script for reboot install           │
└─────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────┐
│                    Backend API Server                       │
│                                                             │
│  • Instructions, tasks, goals, sprint data                  │
│  • Daily report submission                                  │
│  • Latest release metadata                                  │
└─────────────────────────────────────────────────────────────┘
```

### Background alarms

| Alarm | Interval | Action |
|-------|----------|--------|
| `sync-data` | Every 5 minutes | Fetch instructions, tasks, goals, dev status from API |
| `check-release` | Every 1 minute | Check for new game release version |
| `daily-reminder` | Daily at configured time | Prompt user to submit progress report |

---

## Integration with Ninja Era backend

The extension talks to the main Express API at **https://ninjaera.up.railway.app** (default in extension settings).

1. Start the main server: from repo root, `npm run dev` (or `cd backend && npm run start:dev`)
2. Load the unpacked `game-manager/extension` folder in Chrome
3. Open **Settings** → set **Your Name**, verify API Base URL (`https://ninjaera.up.railway.app` by default)
4. Sync — the service worker connects automatically; no login required

Daily reports use `/api/daily-reports` (not `/api/reports`, which is reserved for chat moderation).

Admin CRUD lives under `/api/admin/dev-manager/*` (instructions, goals, tasks, releases, sprint, reports).

The local `server/mock-server.js` remains available for offline UI work only (`npm run server` in this folder).

---

## Prerequisites

- **Google Chrome** (version 116+ recommended for side panel support)
- **Node.js** 18+ ([https://nodejs.org](https://nodejs.org))
- **Windows 10/11** (required for native host and reboot install)
- **PowerShell** (for native host installation)

---

## Quick Start

```powershell
# 1. From the monorepo root, start the main backend (+ frontend if desired)
npm run dev

# 2. Generate extension icons
cd game-manager
npm run icons

# 3. Load the extension in Chrome
#    → chrome://extensions → Developer mode → Load unpacked
#    → Select the `game-manager/extension/` folder

# 4. Install the native host (replace with your Extension ID)
cd native-host
.\install.ps1 -ExtensionId YOUR_EXTENSION_ID

# 5. Open extension Settings: API URL http://localhost:3001, then Sign In
#    (use a team member or admin account)
```

---

## Installation

### Step 1 — Generate icons

```powershell
npm run icons
```

This creates `extension/assets/icons/icon16.png`, `icon48.png`, and `icon128.png`.

### Step 2 — Load the extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder inside this repository
5. Copy the **Extension ID** shown on the extension card (a 32-character string)

### Step 3 — Start the API server

Use the main Ninja Era backend (implements all Dev Manager routes):

```powershell
# from repo root
npm run dev
# API: http://localhost:3001
```

Optional offline mock (no auth, in-memory only):

```powershell
cd game-manager
npm run server
# http://localhost:3847
```

For production, point the extension at your deployed backend and sign in as a team member.

### Step 4 — Install the native messaging host

The native host is **required** for:
- Writing installers to `%ProgramData%\NinjaEra\GameManager\`
- Placing a reboot install script in the Windows Startup folder
- Detecting whether the game process is currently running

```powershell
cd native-host
.\install.ps1 -ExtensionId YOUR_EXTENSION_ID
```

Or from the project root:

```powershell
npm run install-native-host
# Then re-run with -ExtensionId if not provided
```

The installer:
1. Verifies Node.js is available
2. Creates `%ProgramData%\NinjaEra\GameManager\`
3. Registers the native messaging host in the Windows registry
4. Writes the manifest with your extension ID

Registry key:

```
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.ninjaera.gamemanager
```

### Step 5 — Configure the extension

1. Click the extension icon in Chrome
2. Click **Settings** in the footer (or right-click the icon → Options)
3. Fill in:
   - **Your Name** and **Role** (used to attribute reports and instruction read state)
   - **API Base URL** (`http://localhost:3001` for local backend, or `https://ninjaera.up.railway.app` for production)
4. Verify the connection status shows green

---

## Configuration

All settings are stored in `chrome.storage.sync` and managed via the Options page.

| Setting | Default | Description |
|---------|---------|-------------|
| `apiBaseUrl` | `https://ninjaera.up.railway.app` | Backend API base URL (production Ninja Era server) |
| `teamMemberName` | _(empty)_ | Display name sent as `X-Team-Member` header |
| `teamMemberRole` | `Developer` | Role label shown in the side panel |
| `projectId` | `ninja-era` | Sent as `X-Project-Id` header |
| `enableNativeHost` | `true` | Use native host for release downloads |
| `dailyReminderEnabled` | `true` | Enable end-of-day report reminder |
| `dailyReminderTime` | `17:00` | Reminder time (24-hour format) |
| `gameProcessName` | `NinjaEra.exe` | Process name checked before install |
| `startupInstallPath` | `C:\ProgramData\Microsoft\Windows\Start Menu\Programs\StartUp` | Where reboot install script is placed |

---

## Usage

### Popup (toolbar icon)

The popup provides quick access to three tabs:

- **Dashboard** — Sprint progress, goals, tasks, release status. Click **Export CSV** to download dev status.
- **Report** — Fill in and submit your daily progress report. Attach optional files. Save drafts locally.
- **Instructions** — View PM instructions. Unread items show a badge count. Click to mark as read.

Use the **↻** button to force a sync, or **⧉** to open the full side panel.

### Side panel

Right-click the extension icon → **Open Ninja Era Dev Panel**, or click **⧉** in the popup.

| View | Contents |
|------|----------|
| **Overview** | Status metrics, milestones, velocity chart, environment health |
| **Task Board** | Kanban columns (To Do → Done). Drag cards to update status |
| **Sprint** | Current sprint stats and burndown chart |
| **Release** | Installed vs latest version, download status, release notes |
| **Activity** | Recent extension events (syncs, reports, releases) |
| **Blockers** | Blocked tasks and project risks |

### Notifications

The extension sends Chrome desktop notifications for:

- **New PM instructions** — immediately on sync when a new instruction appears
- **Urgent instructions** — persistent notification requiring interaction
- **New game releases** — when a version newer than installed is detected
- **Daily report reminder** — at the configured time each day

Clicking a notification opens the relevant tab in the side panel or popup.

### Release auto-update flow

1. Every minute, the service worker calls `/api/releases/latest`
2. If the version is newer than the installed version, a notification is shown
3. The native host downloads the installer to `%ProgramData%\NinjaEra\GameManager\`
4. A batch script (`NinjaEra-Update-On-Reboot.bat`) is written to the Startup folder
5. On next reboot, the script:
   - Waits until `NinjaEra.exe` is **not** running
   - Runs the installer silently (`/S` flag)
   - Deletes the installer and itself

The game is **never updated while running**.

---

## API Reference

The extension expects a REST API on the main Ninja Era backend. Dev Manager endpoints are **public** — no login required. Set your name in Settings; it is sent on every request:

```
Content-Type: application/json
X-Project-Id: ninja-era
X-Team-Member: <configured name>
```

### Endpoints

#### `GET /api/health`

Health check (public). Main server returns `{ "ok": true, ... }`. Extension only checks HTTP 200.

#### `GET /api/instructions`

Returns an array of PM instructions (per-user `read` flag):

```json
[
  {
    "id": "1",
    "title": "Complete combat system balance pass",
    "body": "Review damage values...",
    "from": "Project Manager",
    "receivedAt": "2026-09-01T10:00:00.000Z",
    "read": false,
    "priority": "urgent"
  }
]
```

`priority` is `"normal"` or `"urgent"`.

#### `POST /api/instructions/:id/read`

Mark an instruction as read for the current user. Returns `{ "ok": true }`.

#### `GET /api/goals`

Returns development goals.

#### `GET /api/tasks`

Returns tasks. Status: `todo`, `in_progress`, `review`, `done`, `blocked`.

#### `PATCH /api/tasks/:id`

Update task status (kanban). Body: `{ "status": "in_progress" }`.

#### `GET /api/dev-status`

Returns aggregated development status (sprint, build, milestones, velocity, environments, risks, releaseNotes).

#### `GET /api/releases/latest`

Returns the latest **published** internal game release for the project (`version`, `downloadUrl`, `releaseNotes`, `publishedAt`, `checksum`).

#### `POST /api/daily-reports`

Submit a daily progress report (team-only). Avoids collision with chat moderation `POST /api/reports`.

```json
{
  "date": "2026-09-01",
  "summary": "Completed combat balance pass",
  "completed": "Fixed 3 PvP bugs, merged PR #142",
  "blockers": "Waiting on art assets for new map",
  "nextSteps": "Start netcode latency investigation",
  "hoursWorked": 8,
  "status": "sent"
}
```

Returns the created report with `id` (`report-<n>`) and `submittedAt`.

#### `POST /api/daily-reports/upload`

Upload a file attachment. Prefer `reportId` from the create response (`report-123`); `YYYY-MM-DD` still resolves to the caller's latest report that day.

#### `GET /api/sprint` / `GET /api/build-status`

Optional dedicated endpoints (dashboard primarily uses `dev-status`).

### Admin (requireAuth + requireAdmin)

Mounted under `/api/admin/dev-manager/…` — overview, CRUD for instructions/goals/tasks/releases, list reports, patch sprint and build status.

---

## Native Messaging Host

### Location

| Item | Path |
|------|------|
| Host script | `native-host/ninja-era-host.js` |
| Launcher | `native-host/ninja-era-host.bat` |
| Manifest | `native-host/com.ninjaera.gamemanager.installed.json` |
| Download directory | `%ProgramData%\NinjaEra\GameManager\` |
| Log file | `%ProgramData%\NinjaEra\GameManager\host.log` |
| Pending install marker | `%ProgramData%\NinjaEra\GameManager\pending-install.json` |

### Messages

The extension sends JSON messages to the native host:

| Action | Payload | Response |
|--------|---------|----------|
| `download_release` | `version`, `downloadUrl`, `checksum`, `startupPath`, `gameProcessName` | `{ ok, installerPath, scriptPath, version, gameRunning }` |
| `check_process` | `processName` | `{ running: boolean }` |
| `status` | — | `{ connected, version, dataDir, pendingInstall }` |
| `cancel_pending_install` | — | `{ ok: true }` |

### Reboot install script

When a new release is downloaded, the host creates `NinjaEra-Update-On-Reboot.bat` in the Startup folder:

```bat
@echo off
REM Waits for NinjaEra.exe to close, then runs the installer silently
```

The script self-deletes after successful installation.

### Manual cancellation

To cancel a pending reboot install, use the native host `cancel_pending_install` action, or manually delete:

- `%ProgramData%\NinjaEra\GameManager\pending-install.json`
- `NinjaEra-Update-On-Reboot.bat` from the Startup folder

---

## Project Structure

```
game-manager/
├── extension/                    # Chrome extension source
│   ├── manifest.json             # Manifest V3 configuration
│   ├── background/
│   │   └── service-worker.js     # Alarms, sync, notifications, release checks
│   ├── popup/                    # Toolbar popup UI
│   │   ├── popup.html
│   │   ├── popup.css
│   │   ├── popup.js
│   │   └── shared.css            # Shared design system
│   ├── sidepanel/                # Full dashboard side panel
│   │   ├── sidepanel.html
│   │   ├── sidepanel.css
│   │   └── sidepanel.js
│   ├── options/                  # Settings page
│   │   ├── options.html
│   │   ├── options.css
│   │   └── options.js
│   ├── content/
│   │   └── content.js            # Content script (all URLs)
│   ├── lib/
│   │   ├── api.js                # Backend API client
│   │   ├── storage.js            # chrome.storage helpers + types
│   │   ├── csv.js                # CSV export builder
│   │   └── native-host.js        # Native messaging client
│   └── assets/
│       └── icons/                # Extension icons (generated)
├── native-host/                  # Windows native messaging host
│   ├── ninja-era-host.js         # Download, install scheduling, process check
│   ├── ninja-era-host.bat        # Node.js launcher
│   ├── com.ninjaera.gamemanager.json  # Manifest template
│   └── install.ps1               # Registry + manifest installer
├── server/
│   └── mock-server.js            # Development API server (port 3847)
├── scripts/
│   └── generate-icons.js         # PNG icon generator
├── package.json
└── README.md
```

---

## Development

### NPM scripts

| Command | Description |
|---------|-------------|
| `npm run icons` | Generate extension PNG icons |
| `npm run server` | Start mock API on port 3847 |
| `npm run install-native-host` | Run native host installer (PowerShell) |

### Reloading after changes

1. Edit extension files
2. Go to `chrome://extensions`
3. Click the **reload** button on the Ninja Era Dev Manager card
4. For service worker changes, click **Inspect views: service worker** to verify logs

### Connecting to a production API

1. Deploy a backend implementing the [API Reference](#api-reference) endpoints
2. Set the real `downloadUrl` and `checksum` in `/api/releases/latest`
3. In extension Settings, change **API Base URL** to your server
4. Ensure CORS headers allow the extension origin

### Testing notifications

Add a new instruction to the mock server `state.instructions` array with a unique `id`, then click **Sync** in the popup or wait for the 5-minute sync alarm.

### Testing release updates

1. Set `installedVersion` lower than `latestRelease.version` in extension storage (via DevTools → Application → Local Storage)
2. Click **Check Now** in the side panel Release view, or wait for the 1-minute alarm

---

## Troubleshooting

### Extension shows "!" badge

The API server is unreachable. Verify:
- Mock server is running (`npm run server`)
- API Base URL in Settings matches (`http://localhost:3847`)
- No firewall blocking localhost

### Native host not connected

Settings page shows a red native host error. Fix:
1. Ensure Node.js is installed: `node --version`
2. Re-run the installer with your Extension ID:
   ```powershell
   cd native-host
   .\install.ps1 -ExtensionId YOUR_EXTENSION_ID
   ```
3. Restart Chrome completely
4. Check the log: `%ProgramData%\NinjaEra\GameManager\host.log`

### Notifications not appearing

- Verify Chrome notification permissions: `chrome://settings/content/notifications`
- Ensure the extension has the `notifications` permission (check `manifest.json`)
- Windows Focus Assist may suppress notifications

### Release download fails

- Confirm `downloadUrl` in the API response is accessible
- If using checksum verification, ensure the SHA-256 hash matches the file
- Check `%ProgramData%\NinjaEra\GameManager\host.log` for errors
- Without the native host, the extension falls back to Chrome's download dialog

### Reboot install did not run

- Verify `NinjaEra-Update-On-Reboot.bat` exists in the Startup folder
- Check `%ProgramData%\NinjaEra\GameManager\pending-install.json`
- The script waits for `NinjaEra.exe` to close — if the game auto-starts, the install waits
- Run the batch file manually to test (with the game closed)

### Side panel not opening

Requires Chrome 116+. Update Chrome or use the popup instead.

---

## License

Internal team tool for Ninja Era development. Not for public distribution.
