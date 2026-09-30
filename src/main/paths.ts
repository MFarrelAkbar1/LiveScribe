import { app } from 'electron'
import { join } from 'node:path'

/** Folder data pengguna yang terlihat: Documents/LiveScribe (sesi, export, debug). */
export const documentsDir = (): string => join(app.getPath('documents'), 'LiveScribe')

export const debugChunksDir = (sessionId?: string): string =>
  sessionId ? join(documentsDir(), 'debug-chunks', sessionId) : join(documentsDir(), 'debug-chunks')

/** Binary whisper.cpp + model: %APPDATA%/LiveScribe/whisper (bukan Documents — bukan data pengguna). */
export const engineDir = (): string => join(app.getPath('userData'), 'whisper')

/** ID sesi dipakai sebagai nama folder/file → hanya karakter aman (tanpa path traversal). */
export const SESSION_ID_PATTERN = /^[0-9A-Za-z_-]{1,64}$/
