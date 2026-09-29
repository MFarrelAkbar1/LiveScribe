/// <reference types="vite/client" />
import type { LiveScribeApi } from '@shared/ipc'

declare global {
  interface Window {
    api: LiveScribeApi
  }
}
