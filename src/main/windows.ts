import { BrowserWindow } from 'electron'
import { join } from 'node:path'
import { isAppUrl } from './security'

function loadRenderer(win: BrowserWindow, page: string): Promise<void> {
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) return win.loadURL(`${devUrl}/${page}`)
  return win.loadFile(join(__dirname, '../renderer', page))
}

/** Semua jendela: tanpa nodeIntegration, contextIsolation + sandbox aktif, navigasi dikunci. */
function secureWindow(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })
}

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 720,
    minWidth: 640,
    minHeight: 480,
    show: false,
    title: 'LiveScribe',
    backgroundColor: '#14161a',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Tetap proses audio saat jendela diminimize / tertutup jendela lain.
      backgroundThrottling: false
    }
  })
  secureWindow(win)
  win.once('ready-to-show', () => win.show())
  void loadRenderer(win, 'index.html')
  return win
}
