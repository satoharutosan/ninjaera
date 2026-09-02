import { getSettings, saveSettings } from '../lib/storage.js';

import { getConnectionStatus } from '../lib/api.js';



const $ = (sel) => document.querySelector(sel);



async function loadSettings() {

  const s = await getSettings();

  $('#member-name').value = s.teamMemberName;

  $('#member-role').value = s.teamMemberRole;

  $('#api-url').value = s.apiBaseUrl;

  $('#project-id').value = s.projectId;

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



document.addEventListener('DOMContentLoaded', async () => {

  await loadSettings();

  await checkConnection();



  $('#btn-save').addEventListener('click', async () => {

    await saveSettings({

      teamMemberName: $('#member-name').value.trim(),

      teamMemberRole: $('#member-role').value,

      apiBaseUrl: $('#api-url').value.trim(),

      projectId: $('#project-id').value.trim(),

      dailyReminderEnabled: $('#daily-reminder').checked,

      dailyReminderTime: $('#reminder-time').value,

    });

    $('#save-status').textContent = 'Saved!';

    setTimeout(() => { $('#save-status').textContent = ''; }, 2000);

    await checkConnection();

    chrome.runtime.sendMessage({ type: 'SYNC_NOW' });

  });

});

