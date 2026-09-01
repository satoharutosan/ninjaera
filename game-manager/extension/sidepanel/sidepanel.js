const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

async function send(type, payload = {}) {
  return chrome.runtime.sendMessage({ type, ...payload });
}

function switchView(name) {
  $$('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === name));
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatTime(iso) {
  return new Date(iso).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const STATUS_COLUMNS = ['todo', 'in_progress', 'review', 'blocked', 'done'];
const STATUS_LABELS = {
  todo: 'To Do',
  in_progress: 'In Progress',
  review: 'Review',
  blocked: 'Blocked',
  done: 'Done',
};

function renderOverview(data) {
  const tasks = data.tasks;
  const done = tasks.filter((t) => t.status === 'done').length;
  const blocked = tasks.filter((t) => t.status === 'blocked').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;

  $('#status-grid').innerHTML = `
    <div class="status-item"><div class="value">${data.tasks.length}</div><div class="label">Total Tasks</div></div>
    <div class="status-item"><div class="value">${done}</div><div class="label">Completed</div></div>
    <div class="status-item"><div class="value">${inProgress}</div><div class="label">In Progress</div></div>
    <div class="status-item"><div class="value">${blocked}</div><div class="label">Blocked</div></div>
  `;

  const milestones = data.devStatus?.milestones || [];
  $('#milestone-list').innerHTML = milestones.length
    ? milestones.map((m) => `
      <div class="milestone-item">
        <div class="milestone-dot ${m.status}"></div>
        <div>
          <strong>${escapeHtml(m.name)}</strong>
          <div style="font-size:11px;color:var(--text-muted)">${m.progress}% · Due ${m.dueDate}</div>
        </div>
      </div>
    `).join('')
    : '<p style="color:var(--text-muted);font-size:12px">No milestones configured</p>';

  const velocity = data.devStatus?.velocity || [3, 5, 4, 7, 6, 8, 5];
  const maxV = Math.max(...velocity, 1);
  $('#velocity-chart').innerHTML = velocity.map((v) =>
    `<div class="velocity-bar" style="height:${(v / maxV) * 100}%" title="${v} pts"></div>`
  ).join('');

  const envs = data.devStatus?.environments || [
    { name: 'Development', status: 'up' },
    { name: 'Staging', status: 'up' },
    { name: 'Production', status: 'up' },
  ];
  $('#env-status').innerHTML = envs.map((e) => `
    <div class="env-row">
      <span><span class="env-status-dot ${e.status}"></span>${escapeHtml(e.name)}</span>
      <span style="color:var(--text-muted)">${e.status === 'up' ? 'Operational' : 'Down'}</span>
    </div>
  `).join('');
}

function renderKanban(tasks) {
  const board = $('#kanban-board');
  board.innerHTML = STATUS_COLUMNS.map((status) => {
    const colTasks = tasks.filter((t) => t.status === status);
    return `
      <div class="kanban-col" data-status="${status}">
        <h3>${STATUS_LABELS[status]} (${colTasks.length})</h3>
        ${colTasks.map((t) => `
          <div class="kanban-card" draggable="true" data-id="${t.id}">
            <h4>${escapeHtml(t.title)}</h4>
            <p>${escapeHtml(t.assignee)} · P${t.priority}</p>
          </div>
        `).join('')}
      </div>
    `;
  }).join('');

  board.querySelectorAll('.kanban-card').forEach((card) => {
    card.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', card.dataset.id);
    });
  });

  board.querySelectorAll('.kanban-col').forEach((col) => {
    col.addEventListener('dragover', (e) => e.preventDefault());
    col.addEventListener('drop', async (e) => {
      e.preventDefault();
      const taskId = e.dataTransfer.getData('text/plain');
      const newStatus = col.dataset.status;
      await send('UPDATE_TASK_STATUS', { taskId, status: newStatus });
      loadData();
    });
  });
}

function renderSprint(data) {
  const sprint = data.devStatus?.sprint || {};
  $('#sprint-name').textContent = sprint.name || 'Current Sprint';
  $('#sprint-info').innerHTML = `
    <div class="sprint-stat"><div class="value">${sprint.day ?? '—'}</div><div class="label">Day</div></div>
    <div class="sprint-stat"><div class="value">${sprint.progress ?? 0}%</div><div class="label">Progress</div></div>
    <div class="sprint-stat"><div class="value">${sprint.remainingPoints ?? '—'}</div><div class="label">Points Left</div></div>
  `;

  const burndown = sprint.burndown || [40, 38, 35, 30, 28, 22, 18, 15, 10, 8];
  const maxB = Math.max(...burndown, 1);
  $('#burndown-chart').innerHTML = burndown.map((v) =>
    `<div class="burndown-bar" style="height:${(v / maxB) * 100}%" title="${v}"></div>`
  ).join('');
}

function renderRelease(data) {
  const rs = data.releaseState;
  $('#release-details').innerHTML = `
    <div class="release-field"><div class="label">Installed</div><div class="value">v${rs.installedVersion}</div></div>
    <div class="release-field"><div class="label">Latest Available</div><div class="value">v${rs.latestVersion}</div></div>
    <div class="release-field"><div class="label">Last Checked</div><div class="value" style="font-size:13px">${rs.lastChecked ? formatTime(rs.lastChecked) : 'Never'}</div></div>
    <div class="release-field"><div class="label">Download Status</div><div class="value" style="font-size:13px">${rs.downloadStatus}${rs.pendingInstall ? ' (reboot install)' : ''}</div></div>
  `;
  $('#release-notes').textContent = data.devStatus?.releaseNotes || 'No release notes available.';
}

function renderActivity(log) {
  $('#activity-feed').innerHTML = log.length
    ? log.map((a) => `
      <div class="activity-item">
        <span class="time">${formatTime(a.timestamp)}</span>
        <div>
          <span class="type">${a.type}</span>
          <div>${escapeHtml(a.message)}</div>
        </div>
      </div>
    `).join('')
    : '<p style="color:var(--text-muted);font-size:12px">No activity yet</p>';
}

function renderBlockers(tasks, devStatus) {
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const risks = devStatus?.risks || [];

  const items = [
    ...blockedTasks.map((t) => ({ title: t.title, body: `Blocked task assigned to ${t.assignee}`, type: 'task' })),
    ...risks.map((r) => ({ title: r.title, body: r.description, type: 'risk' })),
  ];

  $('#blocker-list').innerHTML = items.length
    ? items.map((b) => `
      <div class="blocker-item">
        <h4>${escapeHtml(b.title)}</h4>
        <p>${escapeHtml(b.body)}</p>
      </div>
    `).join('')
    : '<p style="color:var(--text-muted);font-size:12px">No active blockers 🎉</p>';
}

async function loadData() {
  const data = await send('GET_DASHBOARD');
  $('#panel-subtitle').textContent = data.settings.teamMemberName
    ? `${data.settings.teamMemberName} · ${data.settings.teamMemberRole}`
    : 'Configure your profile in Settings';

  renderOverview(data);
  renderKanban(data.tasks);
  renderSprint(data);
  renderRelease(data);
  renderActivity(data.activityLog);
  renderBlockers(data.tasks, data.devStatus);
}

document.addEventListener('DOMContentLoaded', async () => {
  const { openTab } = await chrome.storage.local.get('openTab');
  if (openTab === 'instructions') switchView('overview');
  if (openTab === 'release') switchView('release');
  if (openTab) await chrome.storage.local.remove('openTab');

  await loadData();

  $$('.nav-item').forEach((item) => {
    item.addEventListener('click', () => switchView(item.dataset.view));
  });

  $('#btn-check-release').addEventListener('click', async () => {
    await send('CHECK_RELEASE');
    await loadData();
  });

  $('#btn-export-csv').addEventListener('click', () => send('EXPORT_CSV'));

  setInterval(loadData, 30000);
});
