import { setImmediate } from 'node:timers/promises'
import type { Snapshot } from '../src/model'
import { FakeDocument } from './fake-document'

let serial = 0
export async function openPanel(snapshot: Snapshot | null, locale = 'en', options: { failed?: boolean } = {}) {
  const document = new FakeDocument()
  const handlers = new Map<string, (payload: any) => unknown>()
  const windowHandlers = new Map<string, () => void>()
  const timers = new Map<number, () => void>()
  const page = { snapshot, failed: options.failed ?? false, requests: 0 }
  const api = {
    locale,
    plugin: { request: async () => {
      page.requests++
      if (page.failed) throw Error('fixture read failed')
      if (!page.snapshot) return new Promise<Snapshot>(() => {})
      return structuredClone(page.snapshot)
    } },
    on(event: string, handler: (payload: any) => unknown) {
      handlers.set(event, handler)
      return { dispose() { handlers.delete(event) } }
    }
  }
  const fakeGlobals = {
    document, orca: api,
    window: { addEventListener: (name: string, handler: () => void) => windowHandlers.set(name, handler) },
    setInterval: (callback: () => void) => { const key = timers.size + 1; timers.set(key, callback); return key },
    clearInterval: (key: number) => timers.delete(key)
  }
  const saved = new Map(Object.keys(fakeGlobals).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(fakeGlobals)) Object.defineProperty(globalThis, key, { value, configurable: true, writable: true })
  const close = () => {
    windowHandlers.get('pagehide')?.()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else Reflect.deleteProperty(globalThis, key)
    }
  }
  try {
    // Distinct module URLs execute the actual entry independently for every page, using Orca's test loader.
    await import(new URL(`../src/panel.ts?page-test=${++serial}`, import.meta.url).href)
    await setImmediate()
    const root = document.querySelector('main')!
    if (!root) throw Error('Panel entry did not mount')
    return { page, api, document, root, handlers, timers, close,
      async emit(event: string, payload: unknown) { await handlers.get(event)?.(payload); await setImmediate() },
      async poll() { for (const callback of timers.values()) callback(); await setImmediate() }
    }
  } catch (error) { close(); throw error }
}
