/**
 * Benchmark engine transkripsi dengan file WAV (16 kHz mono PCM16), memakai Chunker dan
 * SttEngine yang sama persis dengan aplikasi (tanpa capture & IPC).
 *
 *   npm run bench:stt -- <file.wav> [--language id|en|auto] [--engine auto|cpu|gpu]
 *                        [--realtime] [--limit <detik>] [--out <transkrip.txt>]
 *
 * Default: chunk diproses satu per satu (antrean selalu kosong) → latensi murni per chunk.
 * --realtime: audio diumpankan secepat aslinya (1×), seperti capture sungguhan.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_CHUNKER_CONFIG, PCM_SAMPLE_RATE, type ChunkMeta } from '@shared/audio'
import { formatClock } from '@shared/format'
import type { EngineStatus, TranscribeResult } from '@shared/stt'
import type { Language } from '@shared/types'
import { SttEngine, type EnginePreference } from '../src/main/stt/engine'
import { Chunker } from '../src/renderer/audio/dsp/chunker'
import { floatToInt16 } from '../src/renderer/audio/dsp/pcm'

const args = process.argv.slice(2)
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : undefined
}
const file = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'))
if (!file) {
  console.error('Pemakaian: npm run bench:stt -- <file.wav> [--language id] [--engine auto] [--realtime] [--limit s]')
  process.exit(2)
}
const language = (opt('language') ?? 'id') as Language
const preference = (opt('engine') ?? 'auto') as EnginePreference
const realtime = args.includes('--realtime')
const verbose = args.includes('--verbose')
const limitSec = Number(opt('limit') ?? Infinity)
const root = opt('root') ?? join(process.env['APPDATA'] ?? '.', 'LiveScribe', 'whisper')

function readWav16kMono(path: string): Float32Array {
  const buf = readFileSync(path)
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Bukan file WAV')
  let pos = 12
  let fmt: { channels: number; rate: number; bits: number } | null = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const size = buf.readUInt32LE(pos + 4)
    const body = pos + 8
    if (id === 'fmt ') {
      fmt = { channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) }
    } else if (id === 'data') {
      if (!fmt || fmt.channels !== 1 || fmt.rate !== PCM_SAMPLE_RATE || fmt.bits !== 16) {
        throw new Error(`WAV harus 16 kHz mono PCM16 (didapat ${JSON.stringify(fmt)})`)
      }
      const n = Math.min(size, buf.length - body) >> 1
      const out = new Float32Array(n)
      for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(body + i * 2) / 32768
      return out
    }
    pos = body + size + (size & 1)
  }
  throw new Error('Chunk data WAV tidak ditemukan')
}

const pct = (sorted: number[], p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!
const ms = (v: number): string => `${Math.round(v)} ms`

let lastStatusLine = ''
const engine = new SttEngine({
  root,
  fetch: (url, init) => fetch(url, init),
  preference,
  onStatus: (s: EngineStatus) => {
    const line = s.download
      ? `${s.message} ${((s.download.receivedBytes / s.download.totalBytes) * 100).toFixed(0)}%`
      : `${s.state}: ${s.message}`
    if (line !== lastStatusLine) console.error(`[engine] ${line}`)
    lastStatusLine = line
  },
  onRawResult: verbose
    ? ({ meta, json }) => {
        for (const seg of json.segments ?? []) {
          const nsp = (seg.no_speech_prob ?? 0).toFixed(2)
          const lp = (seg.avg_logprob ?? 0).toFixed(2)
          console.log(`      raw #${meta.seq} [${seg.start}–${seg.end}] nsp=${nsp} logp=${lp} |${seg.text}`)
        }
      }
    : undefined
})

const audio = readWav16kMono(file)
const samples = Number.isFinite(limitSec) ? audio.subarray(0, limitSec * PCM_SAMPLE_RATE) : audio
const t0 = performance.now()
await engine.start()
const status = engine.getStatus()
if (status.state !== 'ready') {
  console.error(`Engine tidak siap: ${status.message}`)
  process.exit(1)
}
console.error(`[engine] siap dalam ${ms(performance.now() - t0)} — ${status.device?.toUpperCase()} (${status.deviceName})`)

interface Row {
  meta: ChunkMeta
  res: TranscribeResult
  totalMs: number
}
const rows: Row[] = []
const lines = new Map<string, { startMs: number; text: string }>()
const pending: Promise<void>[] = []
const sessionId = 'bench'
let dropped = 0

function send(meta: ChunkMeta, pcm: Float32Array): Promise<void> {
  const sentAt = performance.now()
  const pcm16 = floatToInt16(pcm)
  return engine.transcribe({ sessionId, meta, pcm: pcm16.buffer, language }).then((res) => {
    const totalMs = performance.now() - sentAt
    rows.push({ meta, res, totalMs })
    for (const s of res.segments) lines.set(s.id, { startMs: s.startMs, text: s.text })
    if (res.amended) lines.get(res.amended.id)!.text = res.amended.text
    const text = res.segments.map((s) => s.text).join(' ')
    const extra = res.filtered.map((f) => `[${f.reason}: ${f.text}]`).join(' ')
    console.log(
      `#${String(meta.seq).padStart(3, '0')} ${formatClock(meta.startMs)} ${(meta.durationMs / 1000).toFixed(1)}s ` +
        `${meta.cutReason.padEnd(10)} ${ms(totalMs).padStart(7)} (inf ${ms(res.inferenceMs)}) | ${text} ${extra}`
    )
  })
}

const queue: { meta: ChunkMeta; pcm: Float32Array }[] = []
const chunker = new Chunker('mix', DEFAULT_CHUNKER_CONFIG, {
  onChunk: (meta, pcm) => queue.push({ meta, pcm }),
  onDrop: () => dropped++
})

// Umpan audio per 20 ms (sama seperti blok dari AudioWorklet, dibulatkan).
const block = PCM_SAMPLE_RATE / 50
const wallStart = performance.now()
for (let off = 0; off < samples.length; off += block) {
  chunker.push(samples.subarray(off, off + block))
  if (off + block >= samples.length) chunker.flush()
  while (queue.length) {
    const { meta, pcm } = queue.shift()!
    if (realtime) pending.push(send(meta, pcm))
    else await send(meta, pcm)
  }
  if (realtime) {
    const due = wallStart + ((off + block) / PCM_SAMPLE_RATE) * 1000
    const wait = due - performance.now()
    if (wait > 1) await new Promise((r) => setTimeout(r, wait))
  }
}
await Promise.all(pending)
await engine.shutdown()

// ─── ringkasan ─────────────────────────────────────────────────────────────
const totals = rows.map((r) => r.totalMs).sort((a, b) => a - b)
const infs = rows.map((r) => r.res.inferenceMs).sort((a, b) => a - b)
const avg = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length)
const audioSec = samples.length / PCM_SAMPLE_RATE
const chunkSec = avg(rows.map((r) => r.meta.durationMs)) / 1000
const reasons = new Map<string, number>()
for (const r of rows) for (const f of r.res.filtered) reasons.set(f.reason, (reasons.get(f.reason) ?? 0) + 1)

console.log('\n══ Ringkasan ══')
console.log(`File            : ${file} (${audioSec.toFixed(1)} s audio)`)
console.log(`Engine          : ${status.device?.toUpperCase()} — ${status.deviceName} · whisper.cpp ${status.engineVersion} · model ${status.model}`)
console.log(`Bahasa          : ${language}   Mode: ${realtime ? 'real-time 1×' : 'sekuensial'}`)
console.log(`Chunk           : ${rows.length} dikirim (rata-rata ${chunkSec.toFixed(2)} s), ${dropped} dilewati chunker`)
console.log(`Latensi/chunk   : rata-rata ${ms(avg(totals))} · p50 ${ms(pct(totals, 0.5))} · p95 ${ms(pct(totals, 0.95))} · maks ${ms(totals.at(-1) ?? 0)}`)
console.log(`Inferensi/chunk : rata-rata ${ms(avg(infs))} · p50 ${ms(pct(infs, 0.5))} · p95 ${ms(pct(infs, 0.95))}`)
console.log(`Real-time factor: ${(avg(infs) / 1000 / chunkSec).toFixed(3)} (inferensi ÷ durasi chunk)`)
console.log(`Dibuang filter  : ${[...reasons].map(([k, v]) => `${k} ${v}`).join(', ') || '—'}`)

const out = opt('out')
if (out) {
  const text = [...lines.values()].map((l) => `[${formatClock(l.startMs)}] ${l.text}`).join('\n')
  writeFileSync(out, text + '\n')
  console.log(`Transkrip       : ${out}`)
}
