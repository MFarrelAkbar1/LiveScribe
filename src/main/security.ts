import { app, type Session } from 'electron'

const devServerUrl = (): string | undefined =>
  !app.isPackaged ? process.env['ELECTRON_RENDERER_URL'] : undefined

/** True jika URL/origin berasal dari UI aplikasi sendiri (dev server atau file:// hasil build). */
export function isAppUrl(url: string | undefined | null): boolean {
  if (!url) return false
  const dev = devServerUrl()
  if (dev) {
    try {
      return new URL(url).origin === new URL(dev).origin
    } catch {
      return false
    }
  }
  return url.startsWith('file://')
}

/** Permission yang boleh diminta renderer. Semua lainnya ditolak. */
const ALLOWED_PERMISSIONS = new Set<string>([
  'media', // mikrofon (getUserMedia)
  'display-capture', // getDisplayMedia → loopback audio sistem
  'clipboard-sanitized-write' // tombol Copy
])

export function hardenSession(ses: Session): void {
  ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(ALLOWED_PERMISSIONS.has(permission) && isAppUrl(details.requestingUrl))
  })
  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return ALLOWED_PERMISSIONS.has(permission) && isAppUrl(requestingOrigin)
  })
}
