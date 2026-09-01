const NATIVE_HOST = 'com.ninjaera.gamemanager';

export function isNativeHostAvailable() {
  return typeof chrome.runtime.connectNative === 'function';
}

export function sendNativeMessage(message) {
  return new Promise((resolve, reject) => {
    if (!isNativeHostAvailable()) {
      reject(new Error('Native messaging is not available'));
      return;
    }

    try {
      chrome.runtime.sendNativeMessage(NATIVE_HOST, message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (response?.error) {
          reject(new Error(response.error));
          return;
        }
        resolve(response);
      });
    } catch (err) {
      reject(err);
    }
  });
}

export async function downloadReleaseToStartup(payload) {
  return sendNativeMessage({
    action: 'download_release',
    ...payload,
  });
}

export async function checkGameRunning(processName) {
  return sendNativeMessage({
    action: 'check_process',
    processName,
  });
}

export async function getNativeHostStatus() {
  return sendNativeMessage({ action: 'status' });
}

export async function cancelPendingInstall() {
  return sendNativeMessage({ action: 'cancel_pending_install' });
}
