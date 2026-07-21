/**
 * Squirrel.Windows install/update/uninstall handling (inlined).
 *
 * electron-builder's portable target is implemented via NsisTarget and warns if
 * `electron-squirrel-startup` appears in package.json dependencies — even when
 * the primary installer is Squirrel. Keep this logic local so Squirrel Setup.exe
 * still creates/removes shortcuts without that npm dependency.
 */
import { app } from 'electron'
import { spawn } from 'node:child_process'
import path from 'node:path'

function runUpdate(args: string[], done: () => void) {
  const updateExe = path.resolve(path.dirname(process.execPath), '..', 'Update.exe')
  spawn(updateExe, args, { detached: true }).on('close', done)
}

/** @returns true if this process was a Squirrel child event and should exit. */
export function handleSquirrelStartup(): boolean {
  if (process.platform !== 'win32') return false

  const cmd = process.argv[1]
  if (!cmd) return false

  const target = path.basename(process.execPath)

  if (cmd === '--squirrel-install' || cmd === '--squirrel-updated') {
    runUpdate([`--createShortcut=${target}`], () => app.quit())
    return true
  }
  if (cmd === '--squirrel-uninstall') {
    runUpdate([`--removeShortcut=${target}`], () => app.quit())
    return true
  }
  if (cmd === '--squirrel-obsolete') {
    app.quit()
    return true
  }

  return false
}
