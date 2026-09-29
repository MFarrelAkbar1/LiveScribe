import type { ChunkerConfig, ChunkDropReason, ChunkMeta, StreamId } from '@shared/audio'
import type { AudioSourceKind, CaptureMode } from '@shared/types'
import type { AudioCapture } from './capture'
import { Chunker } from './dsp/chunker'
import workletUrl from './pcm-worklet.ts?worker&url'
import { PCM_WORKLET_NAME, type WorkletInMessage, type WorkletOutMessage } from './worklet-protocol'

export interface PipelineHandlers {
  onChunk(meta: ChunkMeta, pcm: Float32Array): void
  onDrop(meta: ChunkMeta, reason: ChunkDropReason): void
}

interface Tap {
  node: AudioWorkletNode
  chunker: Chunker
  onFlushed: (() => void) | null
}

const FLUSH_TIMEOUT_MS = 1000
const SEPARATE_SOURCES: AudioSourceKind[] = ['system', 'mic']

/**
 * Menyambungkan capture ke worklet PCM 16 kHz dan Chunker.
 *
 * Mode "mix": satu tap di mixBus → aliran 'mix'.
 * Mode "separate": satu tap per bus sumber → aliran 'system' & 'mic' dengan chunker masing-masing.
 */
export class AudioPipeline {
  private readonly taps = new Map<StreamId, Tap>()

  private constructor(
    private readonly capture: AudioCapture,
    private readonly config: ChunkerConfig,
    private readonly handlers: PipelineHandlers
  ) {}

  static async create(
    capture: AudioCapture,
    mode: CaptureMode,
    config: ChunkerConfig,
    handlers: PipelineHandlers
  ): Promise<AudioPipeline> {
    await capture.ctx.audioWorklet.addModule(workletUrl)
    const pipeline = new AudioPipeline(capture, config, handlers)
    if (mode === 'mix') pipeline.attach('mix', capture.mixBus)
    else for (const kind of SEPARATE_SOURCES) pipeline.attach(kind, capture.getSourceBus(kind))
    return pipeline
  }

  noiseFloorDb(stream: StreamId): number | null {
    return this.taps.get(stream)?.chunker.noiseFloorDb ?? null
  }

  /** Kirim sisa audio (termasuk kalimat yang sedang berjalan), lalu lepas semua node. */
  async stop(): Promise<void> {
    await Promise.all([...this.taps.values()].map((tap) => this.flushTap(tap)))
    for (const tap of this.taps.values()) {
      tap.chunker.flush()
      tap.node.port.onmessage = null
      tap.node.disconnect()
    }
    this.taps.clear()
  }

  private attach(stream: StreamId, source: AudioNode): void {
    const node = new AudioWorkletNode(this.capture.ctx, PCM_WORKLET_NAME, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      // WebAudio yang men-downmix stereo → mono (0,5·(L+R)) sebelum masuk worklet.
      channelCount: 1,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers'
    })
    const tap: Tap = { node, chunker: new Chunker(stream, this.config, this.handlers), onFlushed: null }
    node.port.onmessage = (event: MessageEvent<WorkletOutMessage>) => {
      const msg = event.data
      if (msg.type === 'pcm') tap.chunker.push(msg.samples)
      else tap.onFlushed?.()
    }
    source.connect(node)
    node.connect(this.capture.sink)
    this.taps.set(stream, tap)
  }

  private flushTap(tap: Tap): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, FLUSH_TIMEOUT_MS)
      tap.onFlushed = () => {
        clearTimeout(timer)
        resolve()
      }
      const msg: WorkletInMessage = { type: 'flush', stop: true }
      tap.node.port.postMessage(msg)
    })
  }
}
