import { getSettings } from './storage.js';

async function request(path, options = {}) {
  const settings = await getSettings();
  const url = `${settings.apiBaseUrl.replace(/\/$/, '')}${path}`;

  const headers = {
    'Content-Type': 'application/json',
    'X-Project-Id': settings.projectId,
    'X-Team-Member': settings.teamMemberName,
    ...(options.headers || {}),
  };

  if (settings.authToken) {
    headers.Authorization = `Bearer ${settings.authToken}`;
  }

  const response = await fetch(url, {
    ...options,
    headers,
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
    throw new Error(`API ${response.status}: ${message}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function login(email, password) {
  const settings = await getSettings();
  const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/api/auth/login`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Login failed (${response.status})`);
  }
  return data;
}

export async function fetchMe() {
  return request('/api/auth/me');
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

export async function pingServer() {
  try {
    const settings = await getSettings();
    const url = `${settings.apiBaseUrl.replace(/\/$/, '')}/api/health`;
    const response = await fetch(url);
    return response.ok;
  } catch {
    return false;
  }
}
