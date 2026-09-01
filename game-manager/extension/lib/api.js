import { getSettings } from './storage.js';

function apiOrigin(settings) {
  return settings.apiBaseUrl.replace(/\/$/, '');
}

function buildHeaders(settings, extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Project-Id': settings.projectId,
    'X-Team-Member': settings.teamMemberName,
    ...extra,
  };
}

async function request(path, options = {}) {
  const settings = await getSettings();
  const url = `${apiOrigin(settings)}${path}`;

  const response = await fetch(url, {
    ...options,
    headers: buildHeaders(settings, options.headers || {}),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    let message = text || response.statusText;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.error) message = parsed.error;
    } catch {
      /* keep raw text */
    }
    const err = new Error(message || `HTTP ${response.status}`);
    err.status = response.status;
    throw err;
  }

  if (response.status === 204) return null;
  return response.json();
}

/** Health probe used by sync and UI status indicators. */
export async function getConnectionStatus() {
  const settings = await getSettings();
  const base = apiOrigin(settings);

  try {
    const healthRes = await fetch(`${base}/api/health`);
    if (!healthRes.ok) {
      return { online: false, error: 'Server unreachable' };
    }
    return { online: true, error: null };
  } catch {
    return { online: false, error: 'Server unreachable' };
  }
}

export async function pingServer() {
  const status = await getConnectionStatus();
  return status.online;
}

export async function fetchDevStatus() {
  return request('/api/dev-status');
}

export async function fetchInstructions() {
  return request('/api/instructions');
}

export async function fetchGoals() {
  return request('/api/goals');
}

export async function fetchTasks() {
  return request('/api/tasks');
}

export async function updateTaskStatus(id, status) {
  return request(`/api/tasks/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export async function fetchLatestRelease() {
  return request('/api/releases/latest');
}

/**
 * Resolve a release download URL to something fetchable.
 * Handles relative paths, game-download API redirects, and external URLs.
 */
export async function resolveReleaseDownloadUrl(release) {
  const settings = await getSettings();
  const base = apiOrigin(settings);
  let url = (release?.downloadUrl || '').trim();

  if (!url) {
    try {
      const dl = await request('/api/game-downloads/windows/download');
      if (dl?.externalUrl) return dl.externalUrl;
    } catch {
      /* fall through */
    }
    throw new Error('No download URL configured for this release');
  }

  if (url.startsWith('/')) {
    url = `${base}${url}`;
  }

  // Authenticated API download endpoint — resolve to external URL or direct file URL.
  if (url.includes('/api/game-downloads/') && url.includes('/download')) {
    const response = await fetch(url, {
      headers: buildHeaders(settings, {}),
      redirect: 'follow',
    });
    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(text || `Download metadata failed (${response.status})`);
    }
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      if (data.externalUrl) return data.externalUrl;
      throw new Error('Game download returned no external URL');
    }
    return response.url;
  }

  return url;
}

export async function submitDailyReport(report) {
  return request('/api/daily-reports', {
    method: 'POST',
    body: JSON.stringify(report),
  });
}

export async function uploadReportFile(reportId, fileContent, fileName) {
  return request('/api/daily-reports/upload', {
    method: 'POST',
    body: JSON.stringify({ reportId, fileContent, fileName }),
  });
}

export async function markInstructionRead(id) {
  return request(`/api/instructions/${id}/read`, { method: 'POST' });
}

export async function fetchSprintInfo() {
  return request('/api/sprint');
}

export async function fetchBuildStatus() {
  return request('/api/build-status');
}
