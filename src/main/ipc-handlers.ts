import { app, BrowserWindow, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { mkdir } from 'node:fs/promises'
import type { EventChannel, EventPayload, InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipc'
import { saveDebugChunk } from './debug-chunks'
import { debugChunksDir, SESSION_ID_PATTERN } from './paths'
import { isAppUrl } from './security'
import type { SttEngine } from './stt/engine'

type Handler<C extends InvokeChannel> = (
  event: IpcMainInvokeEvent,
  ...args: InvokeArgs<C>
) => InvokeResult<C> | Promise<InvokeResult<C>>

/** ipcMain.handle yang ter-typing + menolak pemanggil yang bukan UI aplikasi. */
function handle<C extends InvokeChannel>(channel: C, handler: Handler<C>): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAppUrl(event.senderFrame?.url)) {
      throw new Error(`Pengirim IPC tidak dikenal untuk ${channel}`)
    }
    return handler(event, ...(args as InvokeArgs<C>))
  })
}

/** Kirim event ter-typing ke semua jendela. */
export function broadcast<C extends EventChannel>(channel: C, payload: EventPayload<C>): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}

export function registerIpcHandlers(engine: SttEngine): void {
  handle('app:get-info', () => ({
    version: app.getVersion(),
    electron: process.versions.electron,
    platform: process.platform
  }))

  handle('debug:save-chunk', (_event, req) => saveDebugChunk(req))

  handle('debug:open-chunk-folder', async (_event, sessionId) => {
    const dir = debugChunksDir(sessionId && SESSION_ID_PATTERN.test(sessionId) ? sessionId : undefined)
    await mkdir(dir, { recursive: true })
    const error = await shell.openPath(dir)
    if (error) throw new Error(error)
  })

  handle('stt:get-status', () => engine.getStatus())
  handle('stt:transcribe', (_event, req) => engine.transcribe(req))
  handle('stt:retry', () => {
    void engine.start()
  })
  handle('stt:cancel-download', () => engine.cancelDownload())
}
