import { app, BrowserWindow, session } from 'electron'
import { registerLoopbackCapture } from './capture'
import { registerIpcHandlers } from './ipc-handlers'
import { hardenSession } from './security'
import { createMainWindow } from './windows'

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  let mainWindow: BrowserWindow | null = null

  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    app.setAppUserModelId('com.livescribe.app')
    hardenSession(session.defaultSession)
    registerLoopbackCapture(session.defaultSession)
    registerIpcHandlers()

    mainWindow = createMainWindow()
    mainWindow.on('closed', () => (mainWindow = null))

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
