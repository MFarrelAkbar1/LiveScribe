import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  EVENT_CHANNELS,
  INVOKE_CHANNELS,
  type EventChannel,
  type InvokeChannel,
  type LiveScribeApi
} from '@shared/ipc'

const isInvokeChannel = (c: string): c is InvokeChannel => Object.hasOwn(INVOKE_CHANNELS, c)
const isEventChannel = (c: string): c is EventChannel => Object.hasOwn(EVENT_CHANNELS, c)

const api: LiveScribeApi = {
  invoke(channel, ...args) {
    if (!isInvokeChannel(channel)) {
      return Promise.reject(new Error(`IPC channel tidak diizinkan: ${String(channel)}`))
    }
    return ipcRenderer.invoke(channel, ...args)
  },
  on(channel, listener) {
    if (!isEventChannel(channel)) throw new Error(`IPC channel tidak diizinkan: ${String(channel)}`)
    // Jangan pernah meneruskan objek `event` ke renderer (berisi akses ke ipcRenderer).
    const wrapped = (_event: IpcRendererEvent, payload: unknown): void =>
      listener(payload as Parameters<typeof listener>[0])
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('api', api)
