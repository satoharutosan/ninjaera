const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, 3000);
}

function switchTab(tabName) {
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === tabName));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === `panel-${tabName}`));
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function renderGoals(goals) {
  const el = $('#goal-list');
  if (!goals.length) {
    el.innerHTML = '<div class="empty-state"><span>🎯</span>No goals assigned yet</div>';
    return;
  }
  el.innerHTML = goals.map((g) => `
    <div class="goal-item">
      <h3>${escapeHtml(g.title)}</h3>
      <div class="goal-meta">
        <span>Due ${formatDate(g.dueDate)}</span>
        <span>${g.progress}%</span>
      </div>
      <div class="goal-progress"><div class="goal-progress-fill" style="width:${g.progress}%"></div></div>
    </div>
  `).join('');
}

function renderTasks(tasks) {
  const el = $('#task-list');
  if (!tasks.length) {
    el.innerHTML = '<div class="empty-state"><span>📋</span>No active tasks</div>';
    return;
  }
  el.innerHTML = tasks.slice(0, 6).map((t) => `
    <div class="task-item">
      <div class="task-status ${t.status}"></div>
      <div class="task-info">
        <h3>${escapeHtml(t.title)}</h3>
        <p>${escapeHtml(t.assignee)} · ${t.status.replace('_', ' ')}</p>
      </div>
    </div>
  `).join('');
}

function renderInstructions(instructions) {
  const el = $('#instruction-list');
  const unread = instructions.filter((i) => !i.read).length;
  const badge = $('#unread-badge');
  badge.textContent = unread;
  badge.hidden = unread === 0;

  if (!instructions.length) {
    el.innerHTML = '<div class="empty-state"><span>📬</span>No instructions yet</div>';
    return;
  }

  el.innerHTML = instructions.map((i) => `
    <div class="instruction-item ${i.read ? '' : 'unread'} ${i.priority === 'urgent' ? 'urgent' : ''}"
         data-id="${i.id}">
      <h3>${escapeHtml(i.title)} ${i.priority === 'urgent' ? '<span class="tag urgent">Urgent</span>' : ''}</h3>
      <p>${escapeHtml(i.body)}</p>
      <div class="instruction-meta">
        <span>From ${escapeHtml(i.from)}</span>
        <span>${formatDate(i.receivedAt)}</span>
      </div>
    </div>
  `).join('');

  el.querySelectorAll('.instruction-item').forEach((item) => {
    item.addEventListener('click', async () => {
      await send('MARK_INSTRUCTION_READ', { id: item.dataset.id });
      item.classList.remove('unread');
      loadDashboard();
    });
  });
}

function renderStatusBanner(data) {
  const banner = $('#status-banner');
  const settings = data.settings || {};
  const syncStatus = data.syncStatus || {};
  renderStatusBannerAsync(banner, settings, syncStatus);
}

async function renderStatusBannerAsync(banner, settings, syncStatus) {
  if (!settings.teamMemberName) {
    banner.hidden = false;
    banner.className = 'auth-banner';
    banner.innerHTML = 'Set your name in Settings so reports are attributed correctly. <a href="#" id="banner-settings">Open Settings</a>';
    banner.querySelector('#banner-settings')?.addEventListener('click', (e) => {
      e.preventDefault();
      chrome.runtime.openOptionsPage();
    });
    return;
  }

  if (syncStatus.lastError) {
    banner.hidden = false;
    banner.className = 'auth-banner error';
    banner.textContent = syncStatus.lastError;
    return;
  }

  banner.hidden = true;
}

function renderDashboard(data) {
  if (!data) {
    renderStatusBanner({ settings: {}, syncStatus: { lastError: 'Could not load dashboard' } });
    return;
  }

  renderStatusBanner(data);
  const sprint = data.devStatus?.sprint;
  const build = data.devStatus?.build;

  $('#sprint-progress').textContent = sprint ? `${sprint.progress}%` : '—';
  $('#sprint-bar').style.width = `${sprint?.progress ?? 0}%`;

  const done = data.tasks.filter((t) => t.status === 'done').length;
  $('#tasks-done').textContent = `${done}/${data.tasks.length}`;

  $('#release-version').textContent = `v${data.releaseState.latestVersion}`;
  const rs = data.releaseState;
  let releaseMeta = 'Up to date';
  if (rs.downloadStatus === 'downloading') releaseMeta = `Downloading ${rs.downloadProgress}%`;
  else if (rs.downloadStatus === 'completed') releaseMeta = 'Downloaded';
  else if (rs.downloadStatus === 'error') releaseMeta = 'Download failed';
  $('#release-status').textContent = releaseMeta;

  $('#build-status').textContent = build?.status ?? '—';
  $('#member-name').textContent = data.settings.teamMemberName || 'Configure in Settings';

  renderGoals(data.goals);
  renderTasks(data.tasks);
  renderInstructions(data.instructions);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function loadDashboard() {
  try {
    const data = await send('GET_DASHBOARD');
    if (data?.error) throw new Error(data.error);
    renderDashboard(data);
  } catch (err) {
    renderDashboard({
      settings: {},
      syncStatus: { lastError: err.message },
      tasks: [],
      goals: [],
      instructions: [],
      releaseState: { latestVersion: '0.0.0', downloadStatus: 'idle' },
      devStatus: {},
    });
  }
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const { openTab } = await chrome.storage.local.get('openTab');
  if (openTab) {
    switchTab(openTab);
    await chrome.storage.local.remove('openTab');
  }

  await loadDashboard();

  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  $('#btn-sync').addEventListener('click', async () => {
    $('#btn-sync').style.animation = 'spin 0.6s linear';
    await send('SYNC_NOW');
    await loadDashboard();
    setTimeout(() => { $('#btn-sync').style.animation = ''; }, 600);
  });

  $('#btn-sidepanel').addEventListener('click', async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.windowId) chrome.sidePanel.open({ windowId: tab.windowId });
  });

  $('#btn-export').addEventListener('click', async () => {
    await send('EXPORT_CSV');
    showToast('CSV export started');
  });

  $('#link-settings').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  $('#report-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const report = {
      date: new Date().toISOString().slice(0, 10),
      summary: $('#report-summary').value,
      completed: $('#report-completed').value,
      blockers: $('#report-blockers').value,
      nextSteps: $('#report-next').value,
      hoursWorked: parseFloat($('#report-hours').value) || 0,
      status: 'sent',
    };

    try {
      const submitted = await send('SUBMIT_REPORT', { report });

      const fileInput = $('#report-file');
      if (fileInput.files.length) {
        const file = fileInput.files[0];
        const fileContent = await fileToBase64(file);
        const { uploadReportFile } = await import('../lib/api.js');
        const reportId = submitted?.id || report.date;
        await uploadReportFile(reportId, fileContent, file.name);
      }

      showToast('Report submitted to PM');
      e.target.reset();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    }
  });

  $('#btn-save-draft').addEventListener('click', () => {
    const draft = {
      summary: $('#report-summary').value,
      completed: $('#report-completed').value,
      blockers: $('#report-blockers').value,
      nextSteps: $('#report-next').value,
      hoursWorked: $('#report-hours').value,
    };
    chrome.storage.local.set({ reportDraft: draft });
    showToast('Draft saved');
  });

  const { reportDraft } = await chrome.storage.local.get('reportDraft');
  if (reportDraft) {
    $('#report-summary').value = reportDraft.summary || '';
    $('#report-completed').value = reportDraft.completed || '';
    $('#report-blockers').value = reportDraft.blockers || '';
    $('#report-next').value = reportDraft.nextSteps || '';
    $('#report-hours').value = reportDraft.hoursWorked || 8;
  }
});

const style = document.createElement('style');
style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
document.head.appendChild(style);
