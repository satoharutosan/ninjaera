#!/usr/bin/env node
/**
 * Ninja Era Native Messaging Host
 * Handles background downloads and schedules game installation on reboot.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { execSync } = require('child_process');

const HOST_VERSION = '1.0.0';
const DATA_DIR = path.join(process.env.PROGRAMDATA || 'C:\\ProgramData', 'NinjaEra', 'GameManager');
const LOG_FILE = path.join(DATA_DIR, 'host.log');

ensureDir(DATA_DIR);

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  try {
    fs.appendFileSync(LOG_FILE, line);
  } catch {
    /* ignore */
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readMessage() {
  const lenBuf = Buffer.alloc(4);
  fs.readSync(0, lenBuf, 0, 4, null);
  const len = lenBuf.readUInt32LE(0);
  const msgBuf = Buffer.alloc(len);
  fs.readSync(0, msgBuf, 0, len, null);
  return JSON.parse(msgBuf.toString('utf8'));
}

function writeMessage(obj) {
  const json = JSON.stringify(obj);
  const buf = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(buf.length, 0);
  fs.writeSync(1, header);
  fs.writeSync(1, buf);
}

function isProcessRunning(processName) {
  try {
    const output = execSync(
      `tasklist /FI "IMAGENAME eq ${processName}" /NH`,
      { encoding: 'utf8', windowsHide: true }
    );
    return output.toLowerCase().includes(processName.toLowerCase());
  } catch {
    return false;
  }
}

function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http;
    const file = fs.createWriteStream(destPath);

    proto.get(url, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        file.close();
        fs.unlinkSync(destPath);
        return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
      }

      if (response.statusCode !== 200) {
        file.close();
        fs.unlinkSync(destPath);
        return reject(new Error(`HTTP ${response.statusCode}`));
      }

      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(destPath);
      });
    }).on('error', (err) => {
      file.close();
      if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
      reject(err);
    });
  });
}

function verifyChecksum(filePath, expected) {
  if (!expected) return true;
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex') === expected.toLowerCase();
}

function createStartupInstaller(installerPath, startupPath, gameProcessName, version) {
  ensureDir(startupPath);

  const scriptName = 'NinjaEra-Update-On-Reboot.bat';
  const scriptPath = path.join(startupPath, scriptName);
  const markerPath = path.join(DATA_DIR, 'pending-install.json');

  const scriptContent = `@echo off
REM Ninja Era auto-update script — runs once on reboot
set INSTALLER="${installerPath.replace(/"/g, '""')}"
set PROCESS="${gameProcessName}"

:waitloop
tasklist /FI "IMAGENAME eq %PROCESS%" 2>nul | find /I "%PROCESS%" >nul
if %ERRORLEVEL%==0 (
  timeout /t 30 /nobreak >nul
  goto waitloop
)

echo Installing Ninja Era v${version}...
start /wait "" %INSTALLER% /S
if exist %INSTALLER% del /F /Q %INSTALLER%
del /F /Q "%~f0"
`;

  fs.writeFileSync(scriptPath, scriptContent, 'utf8');

  fs.writeFileSync(markerPath, JSON.stringify({
    version,
    installerPath,
    scriptPath,
    scheduledAt: new Date().toISOString(),
  }, null, 2));

  log(`Scheduled reboot install: v${version} → ${scriptPath}`);
  return scriptPath;
}

async function handleDownloadRelease(msg) {
  const { version, downloadUrl, checksum, startupPath, gameProcessName } = msg;

  if (isProcessRunning(gameProcessName)) {
    log(`Game ${gameProcessName} is running — will install on reboot only`);
  }

  const installerName = `NinjaEra-${version}-setup.exe`;
  const installerPath = path.join(DATA_DIR, installerName);

  log(`Downloading v${version} from ${downloadUrl}`);
  await downloadFile(downloadUrl, installerPath);

  if (!verifyChecksum(installerPath, checksum)) {
    fs.unlinkSync(installerPath);
    throw new Error('Checksum verification failed');
  }

  const scriptPath = createStartupInstaller(
    installerPath,
    startupPath,
    gameProcessName,
    version
  );

  return {
    ok: true,
    installerPath,
    scriptPath,
    version,
    gameRunning: isProcessRunning(gameProcessName),
  };
}

function handleCancelPending() {
  const markerPath = path.join(DATA_DIR, 'pending-install.json');
  if (fs.existsSync(markerPath)) {
    const pending = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    if (pending.scriptPath && fs.existsSync(pending.scriptPath)) {
      fs.unlinkSync(pending.scriptPath);
    }
    if (pending.installerPath && fs.existsSync(pending.installerPath)) {
      fs.unlinkSync(pending.installerPath);
    }
    fs.unlinkSync(markerPath);
  }
  return { ok: true };
}

function handleStatus() {
  const markerPath = path.join(DATA_DIR, 'pending-install.json');
  let pending = null;
  if (fs.existsSync(markerPath)) {
    pending = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  }
  return {
    connected: true,
    version: HOST_VERSION,
    dataDir: DATA_DIR,
    pendingInstall: pending,
  };
}

async function main() {
  try {
    const msg = readMessage();
    log(`Received: ${msg.action}`);

    let response;
    switch (msg.action) {
      case 'download_release':
        response = await handleDownloadRelease(msg);
        break;
      case 'check_process':
        response = { running: isProcessRunning(msg.processName) };
        break;
      case 'cancel_pending_install':
        response = handleCancelPending();
        break;
      case 'status':
        response = handleStatus();
        break;
      default:
        response = { error: `Unknown action: ${msg.action}` };
    }

    writeMessage(response);
  } catch (err) {
    log(`Error: ${err.message}`);
    writeMessage({ error: err.message });
  }
}

main();
