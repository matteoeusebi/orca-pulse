import type { Snapshot } from './model'
import { PanelState } from './panel-state'

type Context = { displayName: string; branch: string; terminals: { id: string }[] } | null
type Bridge = {
  plugin: { request(name: 'plans.read', input: undefined, options: { signal: AbortSignal; timeoutMs: number }): Promise<Snapshot> }
  on(event: 'workspace.changed', handler: (payload: { context: Context }) => unknown): { dispose(): void }
}
/** Runs once before the first render; all requests, subscriptions and timers end with the panel. */
export function connectPanel(api: Bridge, draw: () => void, state: PanelState) {
  const abort = new AbortController()
  let pending: Promise<void> | null = null
  let queued = false
  let revision = 0
  let lastContext: Context | undefined
  const reload = (): Promise<void> => {
    if (abort.signal.aborted) return Promise.resolve()
    if (pending) { queued = true; return pending }
    const started = revision
    pending = Promise.resolve().then(async () => {
      try {
        const answer = await api.plugin.request('plans.read', undefined, { signal: abort.signal, timeoutMs: 2500 })
        if (!abort.signal.aborted && started === revision) state.accept(answer)
      } catch { if (!abort.signal.aborted && started === revision) state.failed = true }
      finally {
        pending = null
        if (!abort.signal.aborted) draw()
        if (queued && !abort.signal.aborted) { queued = false; await reload() }
      }
    })
    return pending
  }
  const subscription = api.on('workspace.changed', ({ context }) => {
    const renamed = context?.displayName !== lastContext?.displayName || context?.branch !== lastContext?.branch
    const disjoint = lastContext?.terminals.length
      && !context?.terminals.some(terminal => lastContext!.terminals.some(previous => previous.id === terminal.id))
    if (lastContext !== undefined && (renamed || disjoint)) { revision++; state.clearFocus(); draw() }
    lastContext = context
    return reload()
  })
  const timer = setInterval(() => { draw(); void reload() }, 2000)
  void reload()
  return { reload, dispose() { abort.abort(); clearInterval(timer); subscription.dispose() } }
}
