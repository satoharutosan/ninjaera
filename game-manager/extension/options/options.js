import { getSettings, saveSettings } from '../lib/storage.js';
import { getConnectionStatus } from '../lib/api.js';

const $ = (sel) => document.querySelector(sel);

async function loadSettings() {
  const s = await getSettings();
  $('#member-name').value = s.teamMemberName;
  $('#member-role').value = s.teamMemberRole;
  $('#api-url').value = s.apiBaseUrl;
  $('#project-id').value = s.projectId;
  $('#enable-native').checked = s.enableNativeHost;
  $('#game-process').value = s.gameProcessName;
  $('#startup-path').value = s.startupInstallPath;
  $('#daily-reminder').checked = s.dailyReminderEnabled;
  $('#reminder-time').value = s.dailyReminderTime;
}

async function checkConnection() {
  const el = $('#connection-status');
  const status = await getConnectionStatus();
  if (!status.online) {
    el.textContent = '✗ Cannot reach API server';
    el.className = 'connection-status error';
    return;
  }
  el.textContent = '✓ Connected to API server';
  el.className = 'connection-status ok';
}

async function checkNativeHost() {
  const el = $('#native-status');
  try {
    const status = await chrome.runtime.sendMessage({ type: 'NATIVE_STATUS' });
    if (status?.connected !== false) {
      el.textContent = `✓ Native host connected${status?.version ? ` (v${status.version})` : ''}`;
      el.className = 'native-status ok';
    } else {
      throw new Error(status.error || 'Not connected');
    }
  } catch (err) {
    el.textContent = `✗ Native host not available — run native-host/install.ps1 (${err.message})`;
    el.className = 'native-status error';
  }
}

async function persistFormSettings(extra = {}) {
  return saveSettings({
    teamMemberName: $('#member-name').value.trim(),
    teamMemberRole: $('#member-role').value,
    apiBaseUrl: $('#api-url').value.trim(),
    projectId: $('#project-id').value.trim(),
    enableNativeHost: $('#enable-native').checked,
    gameProcessName: $('#game-process').value.trim(),
    startupInstallPath: $('#startup-path').value.trim(),
    dailyReminderEnabled: $('#daily-reminder').checked,
    dailyReminderTime: $('#reminder-time').value,
    ...extra,
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await checkConnection();
  if ($('#enable-native').checked) await checkNativeHost();

  $('#btn-save').addEventListener('click', async () => {
    await persistFormSettings();

    $('#save-status').textContent = 'Saved!';
    setTimeout(() => { $('#save-status').textContent = ''; }, 2000);

    await checkConnection();
    if ($('#enable-native').checked) await checkNativeHost();

    chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
  });
});
