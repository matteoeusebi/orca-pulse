import en from '../locales/en.json' with { type: 'json' }
import it from '../locales/it.json' with { type: 'json' }

export type Key = keyof typeof en
export type Translate = (key: Key, values?: Record<string, string | number>) => string
export function translator(locale: string): Translate {
  const catalog: Partial<Record<Key, string>> = locale.toLowerCase().startsWith('it') ? it : en
  return function t(key, values = {}) {
    return (catalog[key] ?? en[key]).replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) =>
      Object.hasOwn(values, name) ? String(values[name]) : placeholder)
  }
}
export function stepCount(t: Translate, done: number, total: number): string {
  return t(total === 1 ? 'phase.stepDone' : 'phase.stepsDone', { done, total })
}
