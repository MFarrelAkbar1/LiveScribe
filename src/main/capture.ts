import { desktopCapturer, type Session } from 'electron'
import { isAppUrl } from './security'

/**
 * Menjawab getDisplayMedia() dari renderer dengan audio loopback sistem (Windows).
 *
 * Chromium mewajibkan ada sumber video, jadi layar pertama ikut diberikan; renderer
 * langsung menghentikan & membuang video track-nya. Tidak ada dialog picker yang muncul.
 */
export function registerLoopbackCapture(ses: Session): void {
  ses.setDisplayMediaRequestHandler(
    (request, callback) => {
      if (!isAppUrl(request.frame?.url)) {
        console.warn('[capture] permintaan display media ditolak dari', request.frame?.url)
        callback({})
        return
      }
      desktopCapturer
        .getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
        .then((sources) => {
          const screen = sources[0]
          if (!screen) {
            console.error('[capture] tidak ada sumber layar yang tersedia')
            callback({})
            return
          }
          callback({ video: screen, audio: 'loopback' })
        })
        .catch((err: unknown) => {
          console.error('[capture] desktopCapturer gagal:', err)
          callback({})
        })
    },
    { useSystemPicker: false }
  )
}
