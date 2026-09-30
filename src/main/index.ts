import { app, BrowserWindow, net, session } from 'electron'
import { registerLoopbackCapture } from './capture'
import { broadcast, registerIpcHandlers } from './ipc-handlers'
import { engineDir } from './paths'
import { hardenSession } from './security'
import { SttEngine, type EnginePreference } from './stt/engine'
import { createMainWindow } from './windows'

/** Batas waktu menunggu engine berhenti sebelum aplikasi tetap keluar. */
const SHUTDOWN_TIMEOUT_MS = 8000

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null
  let engine: SttEngine | null = null
  let engineStopped = false

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.livescribe.app')
    hardenSession(session.defaultSession)
    registerLoopbackCapture(session.defaultSession)

    engine = new SttEngine({
      root: engineDir(),
      // net.fetch memakai network stack Chromium → ikut pengaturan proxy sistem.
      fetch: (url, init) => net.fetch(url, init),
      preference: enginePreference(),
      onStatus: (status) => broadcast('stt:status', status)
    })
    registerIpcHandlers(engine)

    mainWindow = createMainWindow()
    mainWindow.on('closed', () => (mainWindow = null))
    void engine.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  // Matikan whisper-server dengan bersih sebelum keluar (tidak ada proses yatim).
  app.on('before-quit', (event) => {
    if (engineStopped || !engine) return
    event.preventDefault()
    engineStopped = true
    const timeout = new Promise((r) => setTimeout(r, SHUTDOWN_TIMEOUT_MS))
    void Promise.race([engine.shutdown(), timeout])
      .catch((err: unknown) => console.error('[stt] gagal mematikan engine:', err))
      .finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}

/** LIVESCRIBE_ENGINE=cpu|gpu|auto — untuk tes/benchmark (UI pengaturan menyusul di tahap 4). */
function enginePreference(): EnginePreference {
  const v = process.env['LIVESCRIBE_ENGINE']
  return v === 'cpu' || v === 'gpu' ? v : 'auto'
}
