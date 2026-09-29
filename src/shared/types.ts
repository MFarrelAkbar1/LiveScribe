/**
 * Tipe yang dipakai bersama oleh main, preload, dan renderer.
 * File ini tidak boleh mengimpor modul Node maupun DOM.
 */

/** Sumber audio. Mode "mix" menggabungkan keduanya; mode per-sumber (nanti) memberi label. */
export type AudioSourceKind = 'system' | 'mic'

export const SOURCE_LABELS: Record<AudioSourceKind, string> = {
  system: 'Sistem',
  mic: 'Saya'
}

/** 'mix' = semua sumber dijumlahkan jadi satu aliran. 'separate' disiapkan untuk label Saya/Sistem. */
export type CaptureMode = 'mix' | 'separate'

export type Language = 'id' | 'en' | 'auto'

export interface AppInfo {
  version: string
  electron: string
  platform: string
}
