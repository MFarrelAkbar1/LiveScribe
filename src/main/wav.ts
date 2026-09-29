/** Bungkus PCM Int16 little-endian mono menjadi file WAV (RIFF, 44 byte header). */
export function encodeWav(pcm: Uint8Array, sampleRate: number, channels = 1): Buffer {
  const header = Buffer.alloc(44)
  const byteRate = sampleRate * channels * 2
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + pcm.byteLength, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // ukuran chunk fmt
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(channels * 2, 32) // block align
  header.writeUInt16LE(16, 34) // bit per sampel
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(pcm.byteLength, 40)
  return Buffer.concat([header, pcm])
}
