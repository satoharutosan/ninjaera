import { getSettings, saveSettings } from '../lib/storage.js';
import { pingServer, login, fetchMe } from '../lib/api.js';

const $ = (sel) => document.querySelector(sel);

async function loadSettings() {
  const s = await getSettings();
  $('#member-name').value = s.teamMemberName;
  $('#member-role').value = s.teamMemberRole;
  $('#api-url').value = s.apiBaseUrl;
  $('#project-id').value = s.projectId;
  $('#auth-email').value = s.authEmail || '';
  $('#auth-password').value = '';
  $('#enable-native').checked = s.enableNativeHost;
  $('#game-process').value = s.gameProcessName;
  $('#startup-path').value = s.startupInstallPath;
  $('#daily-reminder').checked = s.dailyReminderEnabled;
  $('#reminder-time').value = s.dailyReminderTime;
  await refreshAuthStatus();
}

async function refreshAuthStatus() {
  const el = $('#auth-status');
  const s = await getSettings();
  if (!s.authToken) {
    el.textContent = 'Not signed in';
    return;
  }
  try {
    const me = await fetchMe();
    const user = me?.user;
    const name = user?.username || s.authEmail;
    const role = user?.isAdmin ? 'admin' : user?.isTeamMember ? 'team' : 'user';
    el.textContent = `Signed in as ${name} (${role})`;
    if (user?.username && !s.teamMemberName) {
      $('#member-name').value = user.username;
    }
  } catch {
    el.textContent = 'Token invalid — sign in again';
  }
}

async function checkConnection() {
  const el = $('#connection-status');
  const ok = await pingServer();
  const s = await getSettings();
  if (!ok) {
    el.textContent = '✗ Cannot reach API server';
    el.className = 'connection-status error';
    return;
  }
  if (!s.authToken) {
    el.textContent = '✓ Server reachable — sign in required for team APIs';
    el.className = 'connection-status ok';
    return;
  }
  try {
    await fetchMe();
    el.textContent = '✓ Connected and authenticated';
    el.className = 'connection-status ok';
  } catch (err) {
    el.textContent = `✓ Server reachable — auth failed (${err.message})`;
    el.className = 'connection-status error';
  }
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

  $('#btn-login').addEventListener('click', async () => {
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    if (!email || !password) {
      $('#auth-status').textContent = 'Email and password required';
      return;
    }
    try {
      await persistFormSettings({ authEmail: email });
      const data = await login(email, password);
      const user = data.user || {};
      await saveSettings({
        authToken: data.token || '',
        authEmail: email,
        teamMemberName: $('#member-name').value.trim() || user.username || '',
      });
      $('#auth-password').value = '';
      await refreshAuthStatus();
      await checkConnection();
      chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
    } catch (err) {
      $('#auth-status').textContent = err.message;
    }
  });

  $('#btn-logout').addEventListener('click', async () => {
    await saveSettings({ authToken: '' });
    await refreshAuthStatus();
    await checkConnection();
  });

  $('#btn-save').addEventListener('click', async () => {
    await persistFormSettings({
      authEmail: $('#auth-email').value.trim(),
    });

    $('#save-status').textContent = 'Saved!';
    setTimeout(() => { $('#save-status').textContent = ''; }, 2000);

    await checkConnection();
    if ($('#enable-native').checked) await checkNativeHost();

    chrome.runtime.sendMessage({ type: 'SYNC_NOW' });
  });
});
