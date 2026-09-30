import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PCM_SAMPLE_RATE } from '@shared/audio'
import type { SaveChunkRequest } from '@shared/ipc'
import { assertValidChunk } from './chunk-validation'
import { debugChunksDir, SESSION_ID_PATTERN } from './paths'
import { encodeWav } from './wav'

const pad = (n: number, width: number): string => String(Math.trunc(n)).padStart(width, '0')

/** 83_450 ms → "01m23.45s" */
function formatOffset(ms: number): string {
  const m = Math.floor(ms / 60_000)
  const s = (ms % 60_000) / 1000
  return `${pad(m, 2)}m${s.toFixed(2).padStart(5, '0')}s`
}

/** Simpan satu chunk sebagai .wav untuk didengarkan (mode debug). Mengembalikan path file. */
export async function saveDebugChunk(req: SaveChunkRequest): Promise<string> {
  const { sessionId, meta, pcm } = req
  if (!SESSION_ID_PATTERN.test(sessionId)) throw new Error('sessionId tidak valid')
  assertValidChunk(meta, pcm)

  const dir = debugChunksDir(sessionId)
  await mkdir(dir, { recursive: true })
  const file = join(dir, `${pad(meta.seq, 4)}_${meta.stream}_${formatOffset(meta.startMs)}_${meta.cutReason}.wav`)
  await writeFile(file, encodeWav(new Uint8Array(pcm), PCM_SAMPLE_RATE))
  return file
}
