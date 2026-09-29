/**
 * Resampler streaming berbasis windowed-sinc (jendela Blackman) dengan low-pass anti-aliasing.
 *
 * - Dipakai di AudioWorklet: tanpa DOM, tanpa alokasi per sampel.
 * - Stateful: hasil identik berapa pun ukuran blok input (128 frame di worklet, apa saja di tes).
 * - Output sampel ke-n berpusat tepat di waktu input n·(inRate/outRate) → tanpa geseran timestamp;
 *   latensinya hanya setengah lebar kernel (~0,5 ms untuk 48 kHz → 16 kHz).
 */

/** Resolusi tabel kernel (titik per 1 sampel input); diinterpolasi linear. */
const TABLE_RESOLUTION = 128

export interface ResamplerOptions {
  /** Jumlah zero-crossing sinc per sisi. Lebih besar = transisi filter lebih tajam, lebih berat. */
  zeroCrossings?: number
  /** Frekuensi cutoff relatif terhadap Nyquist output (0..1). */
  cutoff?: number
}

export class StreamResampler {
  readonly ratio: number
  private readonly halfWidth: number
  private readonly table: Float32Array
  private readonly passthrough: boolean

  /** Riwayat input; buf[0] = sampel input dengan indeks absolut `bufOffset`. */
  private buf: Float32Array
  private bufLen: number
  /** Posisi (pecahan, relatif terhadap buf[0]) pusat sampel output berikutnya. */
  private pos: number
  private out: Float32Array

  constructor(
    readonly inRate: number,
    readonly outRate: number,
    { zeroCrossings = 8, cutoff = 0.9 }: ResamplerOptions = {}
  ) {
    if (!(inRate > 0 && outRate > 0)) throw new RangeError('Sample rate harus > 0')
    this.ratio = inRate / outRate
    this.passthrough = inRate === outRate

    // Cutoff dalam siklus per sampel input. Upsampling: batasi di Nyquist input.
    const fc = 0.5 * Math.min(1, outRate / inRate) * cutoff
    this.halfWidth = zeroCrossings / (2 * fc)
    const size = Math.ceil(this.halfWidth * TABLE_RESOLUTION) + 2
    this.table = new Float32Array(size)
    for (let i = 0; i < size; i++) {
      const d = i / TABLE_RESOLUTION
      if (d >= this.halfWidth) break
      const x = 2 * fc * d
      const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)
      const w = d / this.halfWidth // 0..1
      const blackman = 0.42 + 0.5 * Math.cos(Math.PI * w) + 0.08 * Math.cos(2 * Math.PI * w)
      this.table[i] = 2 * fc * sinc * blackman
    }

    // Isi nol sepanjang halfWidth di kiri supaya output pertama sejajar dengan input pertama.
    const lead = Math.ceil(this.halfWidth)
    this.buf = new Float32Array(Math.max(4096, lead * 4))
    this.bufLen = lead
    this.pos = lead
    this.out = new Float32Array(256)
  }

  /**
   * Masukkan blok input, kembalikan sampel output yang sudah bisa dihitung.
   * Array yang dikembalikan adalah view ke buffer internal — salin jika perlu disimpan.
   */
  process(input: Float32Array): Float32Array {
    if (this.passthrough) return input
    this.append(input)

    const maxOut = Math.ceil((this.bufLen - this.pos) / this.ratio) + 1
    if (this.out.length < maxOut) this.out = new Float32Array(maxOut * 2)

    const { buf, table, halfWidth, ratio } = this
    let n = 0
    let pos = this.pos
    while (pos + halfWidth < this.bufLen - 1) {
      const i0 = Math.ceil(pos - halfWidth)
      const i1 = Math.floor(pos + halfWidth)
      let acc = 0
      for (let i = i0; i <= i1; i++) {
        const t = Math.abs(i - pos) * TABLE_RESOLUTION
        const k = t | 0
        const frac = t - k
        acc += buf[i]! * (table[k]! + (table[k + 1]! - table[k]!) * frac)
      }
      this.out[n++] = acc
      pos += ratio
    }
    this.pos = pos
    this.compact()
    return this.out.subarray(0, n)
  }

  private append(input: Float32Array): void {
    const needed = this.bufLen + input.length
    if (needed > this.buf.length) {
      const grown = new Float32Array(Math.max(needed, this.buf.length * 2))
      grown.set(this.buf.subarray(0, this.bufLen))
      this.buf = grown
    }
    this.buf.set(input, this.bufLen)
    this.bufLen = needed
  }

  /** Buang riwayat yang tidak lagi dibutuhkan kernel. */
  private compact(): void {
    const drop = Math.floor(this.pos - this.halfWidth) - 1
    if (drop <= 0) return
    this.buf.copyWithin(0, drop, this.bufLen)
    this.bufLen -= drop
    this.pos -= drop
  }
}
