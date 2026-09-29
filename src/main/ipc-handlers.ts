import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { mkdir } from 'node:fs/promises'
import type { InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipc'
import { saveDebugChunk } from './debug-chunks'
import { debugChunksDir, SESSION_ID_PATTERN } from './paths'
import { isAppUrl } from './security'

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

export function registerIpcHandlers(): void {
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
}
