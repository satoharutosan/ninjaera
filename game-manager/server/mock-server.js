/**
 * Offline mock API for Ninja Era Dev Manager UI work.
 * Prefer the main backend (port 3001) which implements the real authenticated APIs.
 * Run: node server/mock-server.js
 */

const http = require('http');
const PORT = 3847;

const state = {
  instructions: [
    {
      id: 'inst-001',
      title: 'Complete combat system balance pass',
      body: 'Review damage values for all jutsu types. Target 2-second TTK for standard enemies. Document changes in the balance spreadsheet.',
      from: 'Project Manager',
      receivedAt: new Date(Date.now() - 3600000).toISOString(),
      read: false,
      priority: 'urgent',
    },
    {
      id: 'inst-002',
      title: 'Submit weekly build for QA',
      body: 'Please submit a staging build by Friday EOD. Include release notes for all features merged this sprint.',
      from: 'Project Manager',
      receivedAt: new Date(Date.now() - 86400000).toISOString(),
      read: true,
      priority: 'normal',
    },
  ],
  goals: [
    {
      id: 'goal-001',
      title: 'Ship v0.3.0 — Multiplayer Beta',
      description: 'Complete netcode integration and lobby system',
      dueDate: new Date(Date.now() + 14 * 86400000).toISOString(),
      progress: 62,
    },
    {
      id: 'goal-002',
      title: 'Performance: 60fps on mid-range hardware',
      description: 'Optimize draw calls and particle systems',
      dueDate: new Date(Date.now() + 21 * 86400000).toISOString(),
      progress: 45,
    },
    {
      id: 'goal-003',
      title: 'Localization — JP/EN/KR',
      description: 'Complete string extraction and translation review',
      dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
      progress: 30,
    },
  ],
  tasks: [
    { id: 'task-001', title: 'Implement shadow clone jutsu VFX', status: 'in_progress', assignee: 'Alex', priority: 1, milestone: 'v0.3.0', updatedAt: new Date().toISOString() },
    { id: 'task-002', title: 'Fix hitbox desync in PvP', status: 'blocked', assignee: 'Jordan', priority: 1, milestone: 'v0.3.0', updatedAt: new Date().toISOString() },
    { id: 'task-003', title: 'Design new Hidden Leaf map', status: 'review', assignee: 'Sam', priority: 2, milestone: 'v0.3.0', updatedAt: new Date().toISOString() },
    { id: 'task-004', title: 'Write unit tests for inventory system', status: 'todo', assignee: 'Alex', priority: 3, milestone: 'v0.3.0', updatedAt: new Date().toISOString() },
    { id: 'task-005', title: 'Optimize texture atlas packing', status: 'done', assignee: 'Taylor', priority: 2, milestone: 'v0.2.5', updatedAt: new Date().toISOString() },
    { id: 'task-006', title: 'Integrate Steam achievements', status: 'in_progress', assignee: 'Jordan', priority: 2, milestone: 'v0.3.0', updatedAt: new Date().toISOString() },
  ],
  reports: [],
  latestRelease: {
    version: '0.3.0-beta.2',
    downloadUrl: 'https://example.com/ninja-era/releases/NinjaEra-0.3.0-beta.2-setup.exe',
    releaseNotes: 'v0.3.0-beta.2\n\n- Multiplayer lobby system\n- Shadow clone jutsu prototype\n- Performance improvements\n- Bug fixes for inventory desync',
    publishedAt: new Date().toISOString(),
    checksum: '',
  },
};

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Project-Id, X-Team-Member',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, OPTIONS',
  });
  res.end(JSON.stringify(data));
}

function parseBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch { resolve({}); }
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    return json(res, 204, null);
  }

  const url = req.url;

  if (url === '/api/health') return json(res, 200, { status: 'ok' });

  if (url === '/api/instructions') return json(res, 200, state.instructions);

  if (url === '/api/goals') return json(res, 200, state.goals);

  if (url === '/api/tasks') return json(res, 200, state.tasks);

  if (url === '/api/releases/latest') return json(res, 200, state.latestRelease);

  if (url === '/api/dev-status') {
    return json(res, 200, {
      sprint: {
        name: 'Sprint 12 — Multiplayer Beta',
        day: 8,
        progress: 62,
        remainingPoints: 23,
        burndown: [40, 38, 36, 33, 30, 28, 25, 23],
      },
      build: { status: 'Passing', lastBuild: new Date().toISOString() },
      milestones: [
        { name: 'Alpha Release', status: 'done', progress: 100, dueDate: '2026-06-01' },
        { name: 'Multiplayer Beta', status: 'active', progress: 62, dueDate: '2026-09-15' },
        { name: 'Public Launch', status: 'pending', progress: 15, dueDate: '2026-12-01' },
      ],
      velocity: [5, 7, 6, 8, 7, 9, 8],
      environments: [
        { name: 'Development', status: 'up' },
        { name: 'Staging', status: 'up' },
        { name: 'Production', status: 'up' },
      ],
      risks: [
        { title: 'Netcode latency on cross-region', description: 'Players in EU reporting 200ms+ latency in PvP matches' },
      ],
      releaseNotes: state.latestRelease.releaseNotes,
    });
  }

  if (url === '/api/sprint') {
    return json(res, 200, {
      name: 'Sprint 12 — Multiplayer Beta',
      day: 8,
      totalDays: 14,
      progress: 62,
    });
  }

  if (url === '/api/build-status') {
    return json(res, 200, { status: 'Passing', pipeline: 'main', duration: '4m 32s' });
  }

  if (url === '/api/reports' && req.method === 'POST') {
    // Legacy path — prefer /api/daily-reports on the real backend
    const body = await parseBody(req);
    const report = { id: `report-${Date.now()}`, ...body, submittedAt: new Date().toISOString() };
    state.reports.push(report);
    console.log(`[Report] from ${req.headers['x-team-member']}: ${body.summary?.slice(0, 60)}`);
    return json(res, 201, report);
  }

  if (url === '/api/daily-reports' && req.method === 'POST') {
    const body = await parseBody(req);
    const report = { id: `report-${Date.now()}`, ...body, submittedAt: new Date().toISOString() };
    state.reports.push(report);
    console.log(`[Report] from ${req.headers['x-team-member']}: ${body.summary?.slice(0, 60)}`);
    return json(res, 201, report);
  }

  if ((url === '/api/reports/upload' || url === '/api/daily-reports/upload') && req.method === 'POST') {
    const body = await parseBody(req);
    console.log(`[Upload] ${body.fileName} (${body.fileContent?.length || 0} bytes base64)`);
    return json(res, 200, { ok: true });
  }

  const taskMatch = url.match(/^\/api\/tasks\/(.+)$/);
  if (taskMatch && req.method === 'PATCH') {
    const body = await parseBody(req);
    const task = state.tasks.find((t) => t.id === taskMatch[1]);
    if (task && body.status) {
      task.status = body.status;
      task.updatedAt = new Date().toISOString();
      return json(res, 200, task);
    }
    return json(res, 404, { error: 'Task not found' });
  }

  const readMatch = url.match(/^\/api\/instructions\/(.+)\/read$/);
  if (readMatch && req.method === 'POST') {
    const inst = state.instructions.find((i) => i.id === readMatch[1]);
    if (inst) inst.read = true;
    return json(res, 200, { ok: true });
  }

  json(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`Ninja Era mock API running at http://localhost:${PORT}`);
});
