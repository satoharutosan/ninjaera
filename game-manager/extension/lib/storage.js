/** @typedef {'todo' | 'in_progress' | 'review' | 'done' | 'blocked'} TaskStatus */

/**
 * @typedef {object} DevTask
 * @property {string} id
 * @property {string} title
 * @property {TaskStatus} status
 * @property {string} assignee
 * @property {number} priority
 * @property {string} [milestone]
 * @property {string} updatedAt
 */

/**
 * @typedef {object} PMInstruction
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {string} from
 * @property {string} receivedAt
 * @property {boolean} read
 * @property {'normal' | 'urgent'} priority
 */

/**
 * @typedef {object} DevGoal
 * @property {string} id
 * @property {string} title
 * @property {string} description
 * @property {string} dueDate
 * @property {number} progress
 */

/**
 * @typedef {object} DailyReport
 * @property {string} id
 * @property {string} date
 * @property {string} summary
 * @property {string} completed
 * @property {string} blockers
 * @property {string} nextSteps
 * @property {number} hoursWorked
 * @property {'draft' | 'sent'} status
 */

/**
 * @typedef {object} ReleaseInfo
 * @property {string} version
 * @property {string} downloadUrl
 * @property {string} releaseNotes
 * @property {string} publishedAt
 * @property {string} checksum
 */

/**
 * @typedef {object} AppSettings
 * @property {string} apiBaseUrl
 * @property {string} teamMemberName
 * @property {string} teamMemberRole
 * @property {string} projectId
 * @property {string} authToken
 * @property {string} authEmail
 * @property {boolean} enableNativeHost
 * @property {boolean} dailyReminderEnabled
 * @property {string} dailyReminderTime
 * @property {string} gameProcessName
 * @property {string} startupInstallPath
 */

const DEFAULT_SETTINGS = {
  apiBaseUrl: 'https://ninjaera.up.railway.app',
  teamMemberName: '',
  teamMemberRole: 'Developer',
  projectId: 'ninja-era',
  authToken: '',
  authEmail: '',
  enableNativeHost: true,
  dailyReminderEnabled: true,
  dailyReminderTime: '17:00',
  gameProcessName: 'NinjaEra.exe',
  startupInstallPath:
    'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\StartUp',
};

export async function getSettings() {
  const { settings = {} } = await chrome.storage.sync.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.sync.set({ settings: next });
  return next;
}

export async function getLocal(key, fallback = null) {
  const result = await chrome.storage.local.get(key);
  return result[key] ?? fallback;
}

export async function setLocal(key, value) {
  await chrome.storage.local.set({ [key]: value });
}

export async function getTasks() {
  return getLocal('tasks', []);
}

export async function saveTasks(tasks) {
  await setLocal('tasks', tasks);
}

export async function getInstructions() {
  return getLocal('instructions', []);
}

export async function saveInstructions(instructions) {
  await setLocal('instructions', instructions);
}

export async function getGoals() {
  return getLocal('goals', []);
}

export async function saveGoals(goals) {
  await setLocal('goals', goals);
}

export async function getReports() {
  return getLocal('reports', []);
}

export async function saveReports(reports) {
  await setLocal('reports', reports);
}

export async function getReleaseState() {
  return getLocal('releaseState', {
    currentVersion: '0.0.0',
    latestVersion: '0.0.0',
    lastChecked: null,
    downloadStatus: 'idle',
    downloadProgress: 0,
    pendingInstall: false,
    installedVersion: '0.0.0',
  });
}

export async function saveReleaseState(state) {
  const current = await getReleaseState();
  await setLocal('releaseState', { ...current, ...state });
}

export async function getActivityLog() {
  return getLocal('activityLog', []);
}

export async function appendActivity(entry) {
  const log = await getActivityLog();
  log.unshift({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  });
  await setLocal('activityLog', log.slice(0, 200));
}
