/**
 * Kontrak IPC ter-typing. Satu-satunya sumber kebenaran untuk nama channel & payload.
 *
 * - Invoke  : renderer → main, request/response (ipcRenderer.invoke / ipcMain.handle)
 * - Event   : main → renderer, push (webContents.send / ipcRenderer.on)
 *
 * Objek `*_CHANNELS` bertipe Record<Channel, true> sehingga compiler memaksa daftar
 * whitelist di preload selalu lengkap & sinkron dengan kontrak.
 */
import type { AppInfo } from './types'

export interface IpcInvokeContract {
  'app:get-info': () => AppInfo
}

/** Diisi mulai tahap 3 (status engine, segmen transkrip, progress download). */
export interface IpcEventContract {}

export type InvokeChannel = keyof IpcInvokeContract
export type EventChannel = keyof IpcEventContract

export type InvokeArgs<C extends InvokeChannel> = Parameters<IpcInvokeContract[C]>
export type InvokeResult<C extends InvokeChannel> = Awaited<ReturnType<IpcInvokeContract[C]>>
export type EventPayload<C extends EventChannel> = IpcEventContract[C]

export const INVOKE_CHANNELS: Record<InvokeChannel, true> = {
  'app:get-info': true
}

export const EVENT_CHANNELS: Record<EventChannel, true> = {}

/** API yang diekspos preload ke `window.api`. */
export interface LiveScribeApi {
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>>
  /** Mengembalikan fungsi untuk berhenti berlangganan. */
  on<C extends EventChannel>(channel: C, listener: (payload: EventPayload<C>) => void): () => void
}
