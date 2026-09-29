const VISIBLE_MS = 4000

/** Notifikasi kecil di pojok kanan bawah yang hilang sendiri. */
export class Toaster {
  constructor(private readonly root: HTMLElement) {}

  show(message: string): void {
    const el = document.createElement('div')
    el.className = 'toast'
    el.setAttribute('role', 'status')
    el.textContent = message
    this.root.append(el)
    setTimeout(() => {
      el.classList.add('leaving')
      el.addEventListener('transitionend', () => el.remove(), { once: true })
      setTimeout(() => el.remove(), 500)
    }, VISIBLE_MS)
  }
}
