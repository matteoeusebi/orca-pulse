export const escape = (text: string | number): string => String(text).replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
const svg = (body: string): string => `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${body}</svg>`
export const check = svg('<path d="M3 8.6l3.2 3.2L13 4.6" fill="none" stroke="var(--done)" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>')
export const queue = svg('<circle cx="8" cy="8" r="5.6" fill="none" stroke="var(--orca-muted-foreground)" stroke-width="1.3" stroke-dasharray="2.2 2"/>')
export const cross = svg('<path d="M4.5 4.5l7 7M11.5 4.5l-7 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>')
export const barred = svg('<circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/><path d="M5.4 8h5.2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>')
export const jump = '<svg class="jump" width="9" height="9" viewBox="0 0 9 9" aria-hidden="true"><path d="M2.5 6.5l4-4M3.5 2.5h3v3" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
export const chevron = '<svg class="chevron" width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M3.5 2l3 3-3 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>'
export const dot = '<span class="dot" aria-hidden="true"></span>'
export const amber = '<span class="dot amber" aria-hidden="true"></span>'
export const idle = '<span class="dot hollow" aria-hidden="true"></span>'
export const spinner = '<span class="spinner" aria-hidden="true"></span>'
export function pie(fraction: number): string {
  const ratio = Math.max(0, Math.min(1, fraction))
  const angle = ratio * 2 * Math.PI
  const fill = ratio === 1 ? '<circle cx="8" cy="8" r="3.6" fill="currentColor"/>' : ratio === 0 ? ''
    : `<path d="M8 8V4.4A3.6 3.6 0 ${angle > Math.PI ? 1 : 0} 1 ${(8 + 3.6 * Math.sin(angle)).toFixed(3)} ${(8 - 3.6 * Math.cos(angle)).toFixed(3)}Z" fill="currentColor"/>`
  return svg(`<circle cx="8" cy="8" r="5.9" fill="none" stroke="currentColor" stroke-width="0.6"/>${fill}`)
}
