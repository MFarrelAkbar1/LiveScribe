const pad2 = (n: number): string => String(n).padStart(2, '0')

/** ID sesi berbasis waktu lokal: 2026-09-29_14-30-05 (aman untuk nama file). */
export function sessionIdFromDate(d: Date): string {
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
  const time = `${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}`
  return `${date}_${time}`
}

/** 3_723_000 ms → "01:02:03" */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${pad2(Math.floor(total / 3600))}:${pad2(Math.floor((total % 3600) / 60))}:${pad2(total % 60)}`
}
