/** Pesan antara AudioPipeline (thread utama) dan pcm-worklet (thread audio). */

export const PCM_WORKLET_NAME = 'livescribe-pcm'

export type WorkletInMessage =
  /** Kirim sisa batch; `stop` = hentikan processor setelahnya. */
  { type: 'flush'; stop: boolean }

export type WorkletOutMessage =
  | { type: 'pcm'; samples: Float32Array<ArrayBuffer> }
  | { type: 'flushed' }
