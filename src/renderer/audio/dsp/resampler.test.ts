import { describe, expect, it } from 'vitest'
import { StreamResampler } from './resampler'

const sine = (freq: number, rate: number, seconds: number, amp = 0.5): Float32Array =>
  Float32Array.from({ length: Math.round(rate * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / rate))

const rms = (x: Float32Array): number => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)

function runInBlocks(r: StreamResampler, input: Float32Array, block: number): Float32Array {
  const parts: number[] = []
  for (let i = 0; i < input.length; i += block) parts.push(...r.process(input.subarray(i, i + block)))
  return Float32Array.from(parts)
}

/** Estimasi frekuensi dari jumlah zero-crossing naik. */
function estimateFreq(x: Float32Array, rate: number): number {
  let crossings = 0
  for (let i = 1; i < x.length; i++) if (x[i - 1]! < 0 && x[i]! >= 0) crossings++
  return (crossings * rate) / x.length
}

describe('StreamResampler', () => {
  it.each([48_000, 44_100, 96_000])('%i Hz → 16 kHz: durasi, frekuensi & amplitudo 1 kHz terjaga', (inRate) => {
    const out = runInBlocks(new StreamResampler(inRate, 16_000), sine(1000, inRate, 1), 128)
    expect(Math.abs(out.length - 16_000)).toBeLessThan(40) // tertahan ≤ setengah kernel
    const steady = out.subarray(200, out.length - 200)
    expect(estimateFreq(steady, 16_000)).toBeCloseTo(1000, -1)
    expect(rms(steady)).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })

  it('meredam frekuensi di atas Nyquist output (anti-aliasing)', () => {
    const out = runInBlocks(new StreamResampler(48_000, 16_000), sine(12_000, 48_000, 1), 128)
    const attenuationDb = 20 * Math.log10(rms(out.subarray(200, -200)) / (0.5 / Math.SQRT2))
    expect(attenuationDb).toBeLessThan(-50)
  })

  it('hasil identik berapa pun ukuran blok input', () => {
    const input = sine(440, 48_000, 0.5)
    const a = runInBlocks(new StreamResampler(48_000, 16_000), input, 128)
    const b = runInBlocks(new StreamResampler(48_000, 16_000), input, 1000)
    const c = runInBlocks(new StreamResampler(48_000, 16_000), input, 7)
    expect(b.length).toBe(a.length)
    expect(c.length).toBe(a.length)
    for (let i = 0; i < a.length; i++) {
      expect(b[i]).toBeCloseTo(a[i]!, 6)
      expect(c[i]).toBeCloseTo(a[i]!, 6)
    }
  })

  it('tanpa geseran waktu: impuls di input t=0,5 s muncul di output t=0,5 s', () => {
    const input = new Float32Array(48_000)
    input[24_000] = 1
    const out = runInBlocks(new StreamResampler(48_000, 16_000), input, 128)
    let argmax = 0
    for (let i = 1; i < out.length; i++) if (Math.abs(out[i]!) > Math.abs(out[argmax]!)) argmax = i
    expect(argmax).toBe(8_000)
  })

  it('passthrough jika sample rate sama', () => {
    const input = sine(440, 16_000, 0.1)
    expect(new StreamResampler(16_000, 16_000).process(input)).toEqual(input)
  })
})
