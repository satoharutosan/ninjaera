import {
  getSettings,
  saveSettings,
  getInstructions,
  saveInstructions,
  getGoals,
  saveGoals,
  getTasks,
  saveTasks,
  getReleaseState,
  saveReleaseState,
  appendActivity,
  saveSyncStatus,
} from '../lib/storage.js';
import {
  fetchInstructions,
  fetchGoals,
  fetchTasks,
  fetchLatestRelease,
  fetchDevStatus,
  getConnectionStatus,
  resolveReleaseDownloadUrl,
} from '../lib/api.js';
import { downloadReleaseToStartup, getNativeHostStatus } from '../lib/native-host.js';

const ALARM_SYNC = 'sync-data';
const ALARM_RELEASE = 'check-release';
const ALARM_DAILY = 'daily-reminder';

chrome.runtime.onInstalled.addListener(async () => {
  await setupAlarms();
  await syncAllData();
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });

  chrome.contextMenus.create({
    id: 'open-sidepanel',
    title: 'Open Ninja Era Dev Panel',
    contexts: ['action'],
  });

  appendActivity({ type: 'system', message: 'Extension installed and initialized' });
});

chrome.runtime.onStartup.addListener(async () => {
  await setupAlarms();
  await syncAllData();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'sync' && changes.settings) {
    const prev = changes.settings.oldValue || {};
    const next = changes.settings.newValue || {};
    if (next.dailyReminderTime && next.dailyReminderTime !== prev.dailyReminderTime) {
      scheduleDailyReminder(next.dailyReminderTime);
    }
    if (
      next.teamMemberName !== prev.teamMemberName ||
      next.apiBaseUrl !== prev.apiBaseUrl ||
      next.projectId !== prev.projectId
    ) {
      await syncAllData();
      await checkForNewRelease();
    }
  }
});

async function setupAlarms() {
  await chrome.alarms.clearAll();

  chrome.alarms.create(ALARM_SYNC, { periodInMinutes: 5 });
  chrome.alarms.create(ALARM_RELEASE, { periodInMinutes: 1 });

  const settings = await getSettings();
  if (settings.dailyReminderEnabled) {
    scheduleDailyReminder(settings.dailyReminderTime);
  }
}

function scheduleDailyReminder(time) {
  const [hours, minutes] = time.split(':').map(Number);
  const now = new Date();
  const next = new Date();
  next.setHours(hours, minutes, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  chrome.alarms.create(ALARM_DAILY, { when: next.getTime(), periodInMinutes: 24 * 60 });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM_SYNC) await syncAllData();
  if (alarm.name === ALARM_RELEASE) await checkForNewRelease();
  if (alarm.name === ALARM_DAILY) await showDailyReminder();
});

async function updateBadge(status) {
  if (!status.online) {
    await chrome.action.setBadgeBackgroundColor({ color: '#64748b' });
    await chrome.action.setBadgeText({ text: '!' });
    return;
  }
  await chrome.action.setBadgeBackgroundColor({ color: '#16a34a' });
  await chrome.action.setBadgeText({ text: '' });
}

async function syncAllData() {
  const status = await getConnectionStatus();
  await updateBadge(status);
  await saveSyncStatus({
    online: status.online,
    lastError: status.error,
  });

  if (!status.online) return;

  try {
    const [instructions, goals, tasks, devStatus] = await Promise.all([
      fetchInstructions(),
      fetchGoals(),
      fetchTasks(),
      fetchDevStatus().catch(() => null),
    ]);

    const prevInstructions = await getInstructions();
    const newOnes = findNewInstructions(prevInstructions, instructions);

    await saveInstructions(instructions);
    await saveGoals(goals);
    await saveTasks(tasks);

    if (devStatus) {
      await chrome.storage.local.set({ devStatus });
    }

    for (const inst of newOnes) {
      await notifyInstruction(inst);
    }

    await saveSyncStatus({
      lastSyncAt: new Date().toISOString(),
      lastError: null,
      online: true,
    });

    await appendActivity({
      type: 'sync',
      message: `Synced ${tasks.length} tasks, ${instructions.length} instructions`,
    });
  } catch (err) {
    console.error('[Ninja Era] Sync failed:', err);
    await saveSyncStatus({
      lastError: err.message || 'Sync failed',
    });
    await updateBadge(await getConnectionStatus());
  }
}

function findNewInstructions(previous, incoming) {
  const prevIds = new Set(previous.map((i) => i.id));
  return incoming.filter((i) => !prevIds.has(i.id));
}

async function notifyInstruction(instruction) {
  const iconUrl = chrome.runtime.getURL('assets/icons/icon128.png');

  await chrome.notifications.create(`inst-${instruction.id}`, {
    type: 'basic',
    iconUrl,
    title: instruction.priority === 'urgent'
      ? 'Urgent PM Instruction'
      : 'New PM Instruction',
    message: instruction.title,
    priority: instruction.priority === 'urgent' ? 2 : 1,
    requireInteraction: instruction.priority === 'urgent',
  });

  await appendActivity({
    type: 'instruction',
    message: `New instruction: ${instruction.title}`,
    meta: { id: instruction.id },
  });
}

chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId.startsWith('inst-')) {
    await chrome.storage.local.set({ openTab: 'instructions' });
    await chrome.sidePanel.open({ windowId: (await getCurrentWindowId()) });
  }
  if (notificationId === 'daily-reminder') {
    await chrome.storage.local.set({ openTab: 'report' });
    try {
      await chrome.action.openPopup();
    } catch {
      await chrome.sidePanel.open({ windowId: await getCurrentWindowId() });
    }
  }
  if (notificationId.startsWith('release-')) {
    await chrome.storage.local.set({ openTab: 'release' });
    await chrome.sidePanel.open({ windowId: (await getCurrentWindowId()) });
  }
});

async function getCurrentWindowId() {
  const win = await chrome.windows.getLastFocused();
  return win.id;
}

async function checkForNewRelease() {
  const status = await getConnectionStatus();
  if (!status.online) return;

  try {
    const release = await fetchLatestRelease();
    const state = await getReleaseState();
    const settings = await getSettings();

    await saveReleaseState({
      latestVersion: release.version,
      lastChecked: new Date().toISOString(),
    });

    const isNewer = compareVersions(release.version, state.installedVersion) > 0;
    const alreadyDownloaded =
      state.lastDownloadedVersion === release.version &&
      state.downloadStatus === 'completed';
    const canDownload =
      isNewer &&
      state.downloadStatus !== 'downloading' &&
      !alreadyDownloaded;

    if (canDownload) {
      await appendActivity({
        type: 'release',
        message: `New release detected: v${release.version}`,
      });

      await chrome.notifications.create(`release-${release.version}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
        title: 'New Ninja Era Release',
        message: `Version ${release.version} — downloading update.`,
        priority: 1,
      });

      await startBackgroundDownload(release, settings);
    } else if (isNewer && state.downloadStatus === 'error') {
      await startBackgroundDownload(release, settings);
    }
  } catch (err) {
    console.error('[Ninja Era] Release check failed:', err);
    await appendActivity({
      type: 'error',
      message: `Release check failed: ${err.message}`,
    });
  }
}

async function startBackgroundDownload(release, settings) {
  await saveReleaseState({
    downloadStatus: 'downloading',
    downloadProgress: 0,
    pendingInstall: true,
  });

  try {
    const downloadUrl = await resolveReleaseDownloadUrl(release);
    if (!downloadUrl) {
      throw new Error('Release has no download URL');
    }

    const needsApiFetch = downloadUrl.includes('/api/');

    if (settings.enableNativeHost && !needsApiFetch) {
      try {
        const response = await downloadReleaseToStartup({
          version: release.version,
          downloadUrl,
          checksum: release.checksum || '',
          startupPath: settings.startupInstallPath,
          gameProcessName: settings.gameProcessName,
        });

        await saveReleaseState({
          downloadStatus: 'completed',
          downloadProgress: 100,
          pendingInstall: true,
          currentVersion: release.version,
          lastDownloadedVersion: release.version,
          downloadedPath: response?.installerPath,
        });

        await appendActivity({
          type: 'release',
          message: `Downloaded v${release.version} — scheduled for install on reboot`,
        });
        return;
      } catch (nativeErr) {
        console.warn('[Ninja Era] Native host download failed, falling back:', nativeErr.message);
      }
    }

    if (needsApiFetch) {
      const response = await fetch(downloadUrl, {
        headers: {
          'X-Project-Id': settings.projectId,
          'X-Team-Member': settings.teamMemberName,
        },
        redirect: 'follow',
      });
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await response.json();
        if (data.externalUrl) {
          await chrome.downloads.download({
            url: data.externalUrl,
            filename: `NinjaEra-${release.version}-setup.exe`,
            conflictAction: 'uniquify',
          });
        } else {
          throw new Error('No downloadable file URL returned');
        }
      } else {
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        await chrome.downloads.download({
          url: objectUrl,
          filename: `NinjaEra-${release.version}-setup.exe`,
          conflictAction: 'uniquify',
        });
        setTimeout(() => URL.revokeObjectURL(objectUrl), 120000);
      }
    } else {
      await chrome.downloads.download({
        url: downloadUrl,
        filename: `NinjaEra-${release.version}-setup.exe`,
        conflictAction: 'uniquify',
      });
    }

    await saveReleaseState({
      downloadStatus: 'completed',
      downloadProgress: 100,
      pendingInstall: false,
      currentVersion: release.version,
      lastDownloadedVersion: release.version,
    });

    await appendActivity({
      type: 'release',
      message: `Downloaded v${release.version} via browser`,
    });
  } catch (err) {
    console.error('[Ninja Era] Download failed:', err);
    await saveReleaseState({ downloadStatus: 'error', downloadProgress: 0 });
    await appendActivity({
      type: 'error',
      message: `Release download failed: ${err.message}`,
    });
  }
}

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

async function showDailyReminder() {
  await chrome.notifications.create('daily-reminder', {
    type: 'basic',
    iconUrl: chrome.runtime.getURL('assets/icons/icon128.png'),
    title: 'Daily Progress Report',
    message: 'Time to submit your Ninja Era development progress report.',
    priority: 1,
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message).then(sendResponse).catch((err) => {
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message) {
  switch (message.type) {
    case 'SYNC_NOW':
      await syncAllData();
      await checkForNewRelease();
      return { ok: true, syncStatus: await chrome.storage.local.get('syncStatus').then((r) => r.syncStatus) };

    case 'GET_SYNC_STATUS':
      return chrome.storage.local.get('syncStatus').then((r) => r.syncStatus);

    case 'CHECK_RELEASE':
      await checkForNewRelease();
      return await getReleaseState();

    case 'GET_DASHBOARD':
      return getDashboardData();

    case 'SUBMIT_REPORT':
      return submitReport(message.report);

    case 'EXPORT_CSV':
      return exportCsv();

    case 'MARK_INSTRUCTION_READ':
      return markRead(message.id);

    case 'NATIVE_STATUS':
      try {
        return await getNativeHostStatus();
      } catch (err) {
        return { connected: false, error: err.message };
      }

    case 'UPDATE_TASK_STATUS':
      return updateTaskStatus(message.taskId, message.status);

    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function getDashboardData() {
  const [tasks, goals, instructions, releaseState, settings, syncStatus] = await Promise.all([
    getTasks(),
    getGoals(),
    getInstructions(),
    getReleaseState(),
    getSettings(),
    chrome.storage.local.get('syncStatus').then((r) => r.syncStatus),
  ]);

  const { devStatus = {}, activityLog = [] } = await chrome.storage.local.get([
    'devStatus',
    'activityLog',
  ]);

  return {
    tasks,
    goals,
    instructions,
    releaseState,
    settings,
    devStatus,
    syncStatus,
    activityLog: activityLog.slice(0, 20),
  };
}

async function submitReport(report) {
  const status = await getConnectionStatus();
  if (!status.online) {
    throw new Error(status.error || 'Server unreachable');
  }
  const { submitDailyReport } = await import('../lib/api.js');
  const result = await submitDailyReport(report);
  await appendActivity({ type: 'report', message: 'Daily report submitted' });
  return result;
}

async function exportCsv() {
  const data = await getDashboardData();
  const { buildDevStatusCsv, downloadCsv } = await import('../lib/csv.js');

  const csv = buildDevStatusCsv({
    exportedAt: new Date().toISOString(),
    teamMember: data.settings.teamMemberName,
    sprint: data.devStatus?.sprint,
    tasks: data.tasks,
    goals: data.goals,
    instructions: data.instructions,
    release: data.releaseState,
  });

  const date = new Date().toISOString().slice(0, 10);
  await downloadCsv(`ninja-era-dev-status-${date}.csv`, csv);
  await appendActivity({ type: 'export', message: 'Exported dev status CSV' });
  return { ok: true };
}

async function markRead(id) {
  const instructions = await getInstructions();
  const updated = instructions.map((i) =>
    i.id === id ? { ...i, read: true } : i
  );
  await saveInstructions(updated);

  try {
    const { markInstructionRead } = await import('../lib/api.js');
    await markInstructionRead(id);
  } catch {
    /* offline ok */
  }

  return { ok: true };
}

async function updateTaskStatus(taskId, status) {
  const tasks = await getTasks();
  const updated = tasks.map((t) =>
    t.id === taskId
      ? { ...t, status, updatedAt: new Date().toISOString() }
      : t
  );
  await saveTasks(updated);
  await appendActivity({
    type: 'task',
    message: `Task ${taskId} → ${status}`,
  });

  try {
    const { updateTaskStatus: patchTask } = await import('../lib/api.js');
    await patchTask(taskId, status);
  } catch (err) {
    throw new Error(err.message || 'Failed to sync task status');
  }

  return { ok: true };
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'open-sidepanel' && tab?.windowId) {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  }
});
