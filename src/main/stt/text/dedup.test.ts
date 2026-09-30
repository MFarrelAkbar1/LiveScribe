import { describe, expect, it } from 'vitest'
import { dedupOverlap } from './dedup'

describe('dedupOverlap', () => {
  it('tidak mengubah apa pun tanpa overlap', () => {
    expect(dedupOverlap('kita mulai rapatnya', 'rapatnya sudah lengkap', 0)).toEqual({
      text: 'rapatnya sudah lengkap',
      amendedPrev: null,
      removed: []
    })
  })

  it('membuang kata yang terulang di awal chunk baru', () => {
    const out = dedupOverlap('Jadi hari ini kita akan membahas', 'akan membahas roadmap kuartal depan.', 500)
    expect(out.text).toBe('roadmap kuartal depan.')
    expect(out.removed).toEqual(['akan', 'membahas'])
    expect(out.amendedPrev).toBeNull()
  })

  it('mengabaikan tanda baca & kapitalisasi saat mencocokkan', () => {
    const out = dedupOverlap('lalu kita review hasilnya.', 'Hasilnya cukup bagus', 500)
    expect(out.text).toBe('cukup bagus')
  })

  it('toleran salah eja kecil antar-chunk', () => {
    const out = dedupOverlap('tim kita sedang mengerjakan', 'mengerjakn fitur baru', 500)
    expect(out.text).toBe('fitur baru')
  })

  it('melengkapi kata terakhir yang terpotong di chunk lama', () => {
    const out = dedupOverlap('kita perlu mengemb', 'mengembangkan fitur ini', 500)
    expect(out.text).toBe('fitur ini')
    expect(out.amendedPrev).toBe('kita perlu mengembangkan')
  })

  it('membuang potongan kata di awal chunk baru', () => {
    const out = dedupOverlap('kita perlu mengembangkan', 'bangkan fitur ini', 500)
    expect(out.text).toBe('fitur ini')
    expect(out.amendedPrev).toBeNull()
  })

  it('tidak membuang apa pun jika tidak ada yang cocok', () => {
    const out = dedupOverlap('sampai di sini dulu', 'Berikutnya soal anggaran', 500)
    expect(out.text).toBe('Berikutnya soal anggaran')
    expect(out.removed).toEqual([])
  })

  it('tidak mencari lebih jauh dari panjang overlap', () => {
    // 0,5 s → paling banyak 4 kata; kecocokan 6 kata di luar jendela tidak dihitung.
    const prev = 'satu dua tiga empat lima enam'
    const out = dedupOverlap(prev, 'satu dua tiga empat lima enam tujuh', 500)
    expect(out.removed).toEqual([])
  })

  it('melewati token tanda baca di awal', () => {
    const out = dedupOverlap('ini penting sekali', '... sekali lagi saya tekankan', 500)
    expect(out.text).toBe('lagi saya tekankan')
  })

  it('bisa mengosongkan chunk yang seluruhnya duplikat', () => {
    const out = dedupOverlap('oke terima kasih semuanya', 'semuanya', 500)
    expect(out.text).toBe('')
  })
})
