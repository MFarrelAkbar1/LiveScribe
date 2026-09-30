/**
 * Kontrak IPC ter-typing. Satu-satunya sumber kebenaran untuk nama channel & payload.
 *
 * - Invoke  : renderer → main, request/response (ipcRenderer.invoke / ipcMain.handle)
 * - Event   : main → renderer, push (webContents.send / ipcRenderer.on)
 *
 * Objek `*_CHANNELS` bertipe Record<Channel, true> sehingga compiler memaksa daftar
 * whitelist di preload selalu lengkap & sinkron dengan kontrak.
 */
import type { ChunkMeta } from './audio'
import type { EngineStatus, TranscribeRequest, TranscribeResult } from './stt'
import type { AppInfo } from './types'

export interface SaveChunkRequest {
  sessionId: string
  meta: ChunkMeta
  /** PCM Int16 little-endian, 16 kHz mono. */
  pcm: ArrayBuffer
}

export interface IpcInvokeContract {
  'app:get-info': () => AppInfo
  /** Debug: simpan chunk sebagai .wav di Documents/LiveScribe/debug-chunks/<sesi>/. Mengembalikan path. */
  'debug:save-chunk': (req: SaveChunkRequest) => string
  /** Debug: buka folder chunk (sesi tertentu atau folder induk) di Explorer. */
  'debug:open-chunk-folder': (sessionId?: string) => void
  'stt:get-status': () => EngineStatus
  /** Transkripsikan satu chunk. Diproses berurutan (FIFO) oleh engine. */
  'stt:transcribe': (req: TranscribeRequest) => TranscribeResult
  /** Ulangi persiapan engine (setelah error atau download dibatalkan). */
  'stt:retry': () => void
  'stt:cancel-download': () => void
}

export interface IpcEventContract {
  'stt:status': EngineStatus
}

export type InvokeChannel = keyof IpcInvokeContract
export type EventChannel = keyof IpcEventContract

export type InvokeArgs<C extends InvokeChannel> = Parameters<IpcInvokeContract[C]>
export type InvokeResult<C extends InvokeChannel> = Awaited<ReturnType<IpcInvokeContract[C]>>
export type EventPayload<C extends EventChannel> = IpcEventContract[C]

export const INVOKE_CHANNELS: Record<InvokeChannel, true> = {
  'app:get-info': true,
  'debug:save-chunk': true,
  'debug:open-chunk-folder': true,
  'stt:get-status': true,
  'stt:transcribe': true,
  'stt:retry': true,
  'stt:cancel-download': true
}

export const EVENT_CHANNELS: Record<EventChannel, true> = {
  'stt:status': true
}

/** API yang diekspos preload ke `window.api`. */
export interface LiveScribeApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>
  /** Mengembalikan fungsi untuk berhenti berlangganan. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void
}
