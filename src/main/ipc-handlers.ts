import { app, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { InvokeArgs, InvokeChannel, InvokeResult } from '@shared/ipc'
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
}
