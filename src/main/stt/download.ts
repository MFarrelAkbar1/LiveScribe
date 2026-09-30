import { createHash, type Hash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rename, rm, stat } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>

export class IntegrityError extends Error {
  constructor(file: string, expected: string, actual: string) {
    super(`Checksum ${file} tidak cocok (diharapkan ${expected.slice(0, 12)}…, didapat ${actual.slice(0, 12)}…).`)
    this.name = 'IntegrityError'
  }
}

export async function sha256File(path: string, hash: Hash = createHash('sha256')): Promise<string> {
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size
  } catch {
    return null
  }
}

export interface DownloadOptions {
  url: string
  dest: string
  size: number
  sha256: string
  fetch: FetchFn
  signal?: AbortSignal
  /** Dipanggil setiap ada data masuk (receivedBytes termasuk bagian yang sudah ada dari sesi sebelumnya). */
  onProgress?: (receivedBytes: number) => void
}

const MAX_ATTEMPTS = 5
const RETRY_BASE_MS = 1000

/**
 * Unduh ke `<dest>.part` (bisa dilanjutkan via HTTP Range jika terputus / aplikasi ditutup),
 * verifikasi SHA256 selama streaming, lalu rename ke `dest` hanya jika cocok.
 */
export async function downloadVerified(opts: DownloadOptions): Promise<void> {
  const part = `${opts.dest}.part`
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1), opts.signal)
    try {
      await downloadOnce(opts, part)
      return
    } catch (err) {
      if (opts.signal?.aborted || err instanceof IntegrityError) throw err
      lastError = err
      console.warn(`[download] percobaan ${attempt + 1} gagal untuk ${opts.url}:`, err)
    }
  }
  throw new Error(`Gagal mengunduh ${opts.url}: ${errorMessage(lastError)}`)
}

async function downloadOnce(opts: DownloadOptions, part: string): Promise<void> {
  const hash = createHash('sha256')
  let offset = (await fileSize(part)) ?? 0
  if (offset > opts.size) {
    await rm(part, { force: true })
    offset = 0
  }
  // Bagian yang sudah ada ikut di-hash supaya hasil akhir tetap terverifikasi utuh.
  if (offset > 0) for await (const chunk of createReadStream(part)) hash.update(chunk as Buffer)

  if (offset < opts.size) {
    const res = await opts.fetch(opts.url, {
      headers: offset > 0 ? { Range: `bytes=${offset}-` } : {},
      signal: opts.signal
    })
    if (res.status === 200 && offset > 0) {
      // Server mengabaikan Range → mulai dari nol.
      await res.body?.cancel()
      await rm(part, { force: true })
      return downloadOnce(opts, part)
    }
    if (!(res.status === 200 || res.status === 206) || !res.body) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }
    let received = offset
    opts.onProgress?.(received)
    const meter = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        hash.update(chunk)
        received += chunk.length
        opts.onProgress?.(received)
        cb(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(res.body as import('node:stream/web').ReadableStream),
      meter,
      createWriteStream(part, { flags: offset > 0 ? 'a' : 'w' }),
      { signal: opts.signal }
    )
  }

  const size = await fileSize(part)
  const actual = hash.digest('hex')
  if (size !== opts.size || actual !== opts.sha256) {
    await rm(part, { force: true })
    throw new IntegrityError(opts.url.split('/').pop() ?? opts.dest, opts.sha256, actual)
  }
  await rename(part, opts.dest)
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason)
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        reject(signal.reason)
      },
      { once: true }
    )
  })
}

export const errorMessage = (err: unknown): string => (err instanceof Error ? err.message : String(err))
