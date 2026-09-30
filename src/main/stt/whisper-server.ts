/**
 * whisper-server.exe sebagai child process.
 *
 * - Model dimuat SEKALI saat proses start; setiap chunk hanya request HTTP /inference.
 * - Bind hanya ke 127.0.0.1 dengan port acak (dipilih OS lalu diteruskan ke --port).
 * - Tidak ada proses yatim: stop() mematikan proses & menunggu exit. Jika Electron sendiri
 *   crash / di-kill, Windows ikut mematikan child karena libuv memasukkan semua child ke
 *   Job Object dengan JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { dirname } from 'node:path'
import { createInterface } from 'node:readline'
import type { EngineDevice } from '@shared/stt'

export const HOST = '127.0.0.1'

export interface ServerStartOptions {
  exePath: string
  modelPath: string
  threads: number
  useGpu: boolean
  /** Folder kosong untuk --public (default server menyajikan file statis dari cwd). */
  publicDir: string
  log?: (line: string) => void
}

export interface ServerBackend {
  device: EngineDevice
  /** Nama GPU dari log ggml_cuda_init, jika memakai GPU. */
  gpuName: string | null
}

/** Subset respons `response_format=verbose_json`. */
export interface VerboseJson {
  language?: string
  duration?: number
  text?: string
  segments?: {
    text: string
    start?: number
    end?: number
    avg_logprob?: number
    no_speech_prob?: number
  }[]
}

export class ServerStartError extends Error {
  constructor(
    message: string,
    readonly logTail: string[]
  ) {
    super(message)
    this.name = 'ServerStartError'
  }
}

const READY_TIMEOUT_MS = 120_000
const HEALTH_POLL_MS = 150
const STOP_TIMEOUT_MS = 5000
const BIND_RETRIES = 3
const LOG_TAIL = 40
/** STATUS_DLL_NOT_FOUND — biasanya Visual C++ Redistributable belum terpasang. */
const EXIT_DLL_NOT_FOUND = 0xc0000135

export class WhisperServer {
  /** Dipanggil jika proses berhenti TANPA stop() (crash). */
  onUnexpectedExit: ((code: number | null) => void) | null = null
  private stopping = false
  private exited: Promise<void>
  private exitCode: number | null = null
  private hasExited = false

  private constructor(
    private readonly child: ChildProcess,
    readonly port: number,
    readonly backend: ServerBackend
  ) {
    this.exited = new Promise((resolve) => {
      const done = (code: number | null): void => {
        if (this.hasExited) return
        this.hasExited = true
        this.exitCode = code
        resolve()
        if (!this.stopping) this.onUnexpectedExit?.(code)
      }
      if (child.exitCode !== null) done(child.exitCode)
      child.once('exit', (code) => done(code))
    })
  }

  get running(): boolean {
    return !this.hasExited
  }

  get pid(): number | undefined {
    return this.child.pid
  }

  static async start(opts: ServerStartOptions): Promise<WhisperServer> {
    let lastError: unknown
    for (let attempt = 0; attempt < BIND_RETRIES; attempt++) {
      try {
        return await WhisperServer.startOnce(opts, await freePort())
      } catch (err) {
        lastError = err
        // Port sempat diambil proses lain di antara freePort() dan bind → coba port lain.
        if (!(err instanceof ServerStartError && err.logTail.some((l) => l.includes("couldn't bind")))) throw err
      }
    }
    throw lastError
  }

  private static async startOnce(opts: ServerStartOptions, port: number): Promise<WhisperServer> {
    const args = [
      '--model', opts.modelPath,
      '--host', HOST,
      '--port', String(port),
      '--threads', String(opts.threads),
      '--public', opts.publicDir,
      ...(opts.useGpu ? [] : ['--no-gpu'])
    ]
    const child = spawn(opts.exePath, args, {
      cwd: dirname(opts.exePath),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const tail: string[] = []
    const backend: ServerBackend = { device: 'cpu', gpuName: null }
    const onLine = (line: string): void => {
      opts.log?.(line)
      tail.push(line)
      if (tail.length > LOG_TAIL) tail.shift()
      const gpu = /Device \d+: (.+?), compute capability/.exec(line)
      if (gpu) backend.gpuName = gpu[1]!
      if (/whisper_backend_init_gpu: using CUDA\d* backend/.test(line)) backend.device = 'gpu'
    }
    // Kedua pipe WAJIB dikuras; jika buffer pipe penuh, whisper-server akan macet saat menulis log.
    createInterface({ input: child.stderr! }).on('line', onLine)
    createInterface({ input: child.stdout! }).on('line', onLine)

    const failed = new Promise<never>((_, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => reject(new ServerStartError(describeExit(code), [...tail])))
    })
    failed.catch(() => undefined) // ditangani lewat race di bawah; exit normal nanti tidak boleh jadi unhandled
    const server = new WhisperServer(child, port, backend)
    try {
      await Promise.race([waitHealthy(port, () => !server.running), failed])
    } catch (err) {
      await server.stop()
      if (err instanceof ServerStartError) throw err
      throw new ServerStartError(err instanceof Error ? err.message : String(err), [...tail])
    }
    return server
  }

  async inference(wav: Uint8Array, fields: Record<string, string>, timeoutMs: number): Promise<VerboseJson> {
    if (!this.running) throw new Error('whisper-server tidak berjalan')
    const form = new FormData()
    form.append('file', new Blob([wav as Uint8Array<ArrayBuffer>], { type: 'audio/wav' }), 'chunk.wav')
    for (const [key, value] of Object.entries(fields)) form.append(key, value)
    const res = await fetch(`http://${HOST}:${this.port}/inference`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!res.ok) throw new Error(`whisper-server HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    return (await res.json()) as VerboseJson
  }

  /** Matikan proses & tunggu benar-benar keluar. Aman dipanggil berkali-kali. */
  async stop(): Promise<void> {
    this.stopping = true
    if (this.hasExited) return
    // Windows: kill() = TerminateProcess. whisper-server tidak menyimpan state apa pun ke disk.
    this.child.kill()
    const timedOut = await Promise.race([this.exited.then(() => false), delay(STOP_TIMEOUT_MS).then(() => true)])
    if (timedOut) {
      console.error(`[whisper] proses ${this.child.pid} tidak berhenti dalam ${STOP_TIMEOUT_MS} ms`)
      this.child.kill('SIGKILL')
      await this.exited
    }
  }

  get lastExitCode(): number | null {
    return this.exitCode
  }
}

/** Port bebas dari OS (bind ke port 0), lalu dilepas untuk dipakai whisper-server. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.once('error', reject)
    srv.listen(0, HOST, () => {
      const address = srv.address()
      const port = typeof address === 'object' && address ? address.port : 0
      srv.close(() => (port ? resolve(port) : reject(new Error('Gagal mendapatkan port bebas'))))
    })
  })
}

/** Server baru bind SETELAH model termuat; /health 200 = model siap. */
async function waitHealthy(port: number, gaveUp: () => boolean): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS
  while (Date.now() < deadline && !gaveUp()) {
    try {
      const res = await fetch(`http://${HOST}:${port}/health`, { signal: AbortSignal.timeout(1000) })
      await res.body?.cancel()
      if (res.ok) return
    } catch {
      // Belum listen (model masih dimuat).
    }
    await delay(HEALTH_POLL_MS)
  }
  if (gaveUp()) return new Promise<never>(() => undefined) // proses sudah keluar; `failed` yang melapor
  throw new Error(`whisper-server tidak siap dalam ${READY_TIMEOUT_MS / 1000} detik`)
}

function describeExit(code: number | null): string {
  if (code === null) return 'whisper-server berhenti sebelum siap.'
  const unsigned = code >>> 0
  if (unsigned === EXIT_DLL_NOT_FOUND) {
    return 'whisper-server gagal dijalankan: DLL tidak ditemukan (Visual C++ Redistributable belum terpasang?).'
  }
  return `whisper-server berhenti sebelum siap (kode keluar ${code >= 0 && code < 256 ? code : `0x${unsigned.toString(16)}`}).`
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))
