export const RELEASE_FILENAME = 'NinjaEra-setup.exe';

let quietUiActive = false;

/** Hide Chrome download shelf/bubble while extension release downloads run. */
export async function beginQuietDownloads() {
  if (quietUiActive) return;
  try {
    if (chrome.downloads.setUiOptions) {
      await chrome.downloads.setUiOptions({ enabled: false });
    } else if (chrome.downloads.setShelfEnabled) {
      await chrome.downloads.setShelfEnabled(false);
    }
    quietUiActive = true;
  } catch {
    /* another extension may already control UI */
  }
}

/** Restore Chrome download UI after a quiet release download finishes. */
export async function endQuietDownloads() {
  if (!quietUiActive) return;
  try {
    if (chrome.downloads.setUiOptions) {
      await chrome.downloads.setUiOptions({ enabled: true });
    } else if (chrome.downloads.setShelfEnabled) {
      await chrome.downloads.setShelfEnabled(true);
    }
    quietUiActive = false;
  } catch {
    quietUiActive = false;
  }
}

/** Remove a download record from chrome://downloads without deleting the file. */
export async function eraseDownloadHistory(downloadId) {
  try {
    await chrome.downloads.erase({ id: downloadId });
  } catch (err) {
    console.warn('[Ninja Era] Could not erase download history:', err);
  }
}

/**
 * Download a release installer to Chrome's default Downloads folder.
 * @param {{ downloadUrl: string }} payload
 * @returns {Promise<number>} Chrome download ID
 */
export async function downloadRelease({ downloadUrl }) {
  await beginQuietDownloads();
  return chrome.downloads.download({
    url: downloadUrl,
    filename: RELEASE_FILENAME,
    conflictAction: 'overwrite',
    saveAs: false,
  });
}
