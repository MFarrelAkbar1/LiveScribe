/**
 * AudioWorkletProcessor: input (sudah di-downmix ke mono oleh WebAudio) → resample 16 kHz
 * → kirim batch Float32 (100 ms) ke thread utama lewat port (buffer di-transfer, tanpa salin).
 *
 * Saat tidak ada sumber tersambung (mis. sedang restart perangkat) processor tetap mengisi
 * hening, sehingga jumlah sampel = waktu nyata dan timestamp transkrip tidak bergeser.
 */
import { PCM_SAMPLE_RATE } from '@shared/audio'
import { StreamResampler } from './dsp/resampler'
import { PCM_WORKLET_NAME, type WorkletInMessage, type WorkletOutMessage } from './worklet-protocol'

// Global AudioWorkletGlobalScope (tidak ada di lib DOM TypeScript).
declare const sampleRate: number
declare function registerProcessor(name: string, ctor: new (options?: unknown) => AudioWorkletProcessorBase): void
declare class AudioWorkletProcessorBase {
  readonly port: MessagePort
}
const AudioWorkletProcessorImpl = (globalThis as unknown as { AudioWorkletProcessor: typeof AudioWorkletProcessorBase })
  .AudioWorkletProcessor

const BATCH_SAMPLES = PCM_SAMPLE_RATE / 10
const RENDER_QUANTUM = 128

class PcmProcessor extends AudioWorkletProcessorImpl {
  private readonly resampler = new StreamResampler(sampleRate, PCM_SAMPLE_RATE)
  private readonly silence = new Float32Array(RENDER_QUANTUM)
  private batch = new Float32Array(BATCH_SAMPLES)
  private batchLen = 0
  private stopped = false

  constructor() {
    super()
    this.port.onmessage = (event: MessageEvent<WorkletInMessage>) => {
      if (event.data.type === 'flush') {
        this.sendBatch()
        this.stopped = event.data.stop
        this.post({ type: 'flushed' })
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false
    const channel = inputs[0]?.[0] ?? this.silence
    const out = this.resampler.process(channel)
    let offset = 0
    while (offset < out.length) {
      const take = Math.min(BATCH_SAMPLES - this.batchLen, out.length - offset)
      this.batch.set(out.subarray(offset, offset + take), this.batchLen)
      this.batchLen += take
      offset += take
      if (this.batchLen === BATCH_SAMPLES) this.sendBatch()
    }
    return true
  }

  private sendBatch(): void {
    if (this.batchLen === 0) return
    const samples = this.batchLen === BATCH_SAMPLES ? this.batch : this.batch.slice(0, this.batchLen)
    this.post({ type: 'pcm', samples }, [samples.buffer])
    this.batch = new Float32Array(BATCH_SAMPLES)
    this.batchLen = 0
  }

  private post(message: WorkletOutMessage, transfer: Transferable[] = []): void {
    this.port.postMessage(message, transfer)
  }
}

registerProcessor(PCM_WORKLET_NAME, PcmProcessor)
