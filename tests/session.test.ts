import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import { connectPanel } from '../src/panel-session'
import { PanelState, planKey } from '../src/panel-state'
import type { Snapshot } from '../src/model'
import { example, foreign } from './panel-fixture'

function bridge(request: () => Promise<Snapshot>) {
  const handlers = new Map<string, (value: any) => unknown>()
  const options: unknown[] = []
  return { handlers, options, api: {
    plugin: { request: (_: string, __: unknown, opts: unknown) => { options.push(opts); return request() } },
    on: (event: string, handler: (value: any) => unknown) => { handlers.set(event, handler); return { dispose() { handlers.delete(event) } } }
  } }
}
const context = { displayName: 'main', branch: 'main', terminals: [{ id: 'a' }] }

test('session refreshes within three seconds, preserves content on failure and resets selection on workspace identity', async () => {
  const { f, data } = await example()
  let result = data; let fail = false
  const host = bridge(async () => { if (fail) throw Error('unavailable'); return result })
  const state = new PanelState()
  const session = connectPanel(host.api, () => {}, state)
  try {
    await session.reload()
    await host.handlers.get('workspace.changed')!({ context })
    const other = data.plans.find(p => p.title === 'Zenit')!
    state.selectPlan(planKey(other))
    await host.handlers.get('workspace.changed')!({ context: { ...context, terminals: [{ id: 'a' }, { id: 'new' }] } })
    assert.equal(state.currentPlan?.title, 'Zenit')
    fail = true
    await session.reload()
    assert.equal(state.failed, true)
    assert.equal(state.currentPlan?.title, 'Zenit')
    await host.handlers.get('workspace.changed')!({ context: { ...context, terminals: [{ id: 'b' }] } })
    assert.equal(state.snapshot?.activeRoot, null)
    assert.equal(state.snapshot?.plans.length, 2)
    fail = false; result = { ...foreign(data), activeRoot: '/another', workspaceKey: 'b' }
    const start = Date.now(); await session.reload()
    assert.ok(Date.now() - start < 3000)
    assert.equal(state.currentPlan?.title, 'Zenit')
    assert.equal((host.options[0] as any).timeoutMs, 2500)
  } finally { session.dispose(); await f.close() }
})

test('same-name workspace switches discard old replies; terminal rename events preserve in-flight replies', async () => {
  const { f, data } = await example()
  let mode = 'initial'; let release!: (data: Snapshot) => void
  let started!: () => void
  const gate = new Promise<void>(resolve => { started = resolve })
  const next = { ...foreign(data), activeRoot: '/another', workspaceKey: 'b' }
  const host = bridge(async () => {
    if (mode === 'pending') { started(); return new Promise<Snapshot>(resolve => { release = resolve }) }
    return mode === 'next' ? next : data
  })
  const state = new PanelState(); const session = connectPanel(host.api, () => {}, state)
  try {
    await session.reload(); await host.handlers.get('workspace.changed')!({ context })
    mode = 'pending'
    const pending = session.reload(); await gate
    const switched = host.handlers.get('workspace.changed')!({ context: { ...context, terminals: [{ id: 'b' }] } })
    mode = 'next'; release(data); await pending; await switched
    assert.equal(state.currentPlan?.title, 'Zenit')
    const key = planKey(data.plans[0]); state.selectPlan(key)
    await host.handlers.get('workspace.changed')!({ context: { ...context, terminals: [{ id: 'b', title: 'renamed' }] } })
    assert.equal(state.selected, key)
  } finally { session.dispose(); await f.close() }
})

test('a synchronous bridge failure can recover and disposal ignores a late reply', async () => {
  const { f, data } = await example()
  let fail = true
  let release!: (value: Snapshot) => void
  const host = bridge(() => {
    if (fail) throw Error('bridge not ready')
    return new Promise<Snapshot>(resolve => { release = resolve })
  })
  const state = new PanelState(); let draws = 0
  const session = connectPanel(host.api, () => { draws++ }, state)
  try {
    await session.reload()
    assert.equal(state.failed, true)
    fail = false
    const pending = session.reload()
    await Promise.resolve()
    assert.equal(typeof release, 'function')
    session.dispose()
    const before = draws
    release(data); await pending
    assert.equal(state.snapshot, null)
    assert.equal(draws, before)
    assert.equal(host.handlers.size, 0)
  } finally { session.dispose(); await f.close() }
})

test('a same-name switch to no terminals discards the old in-flight reply before the new reply arrives', async () => {
  const { f, data } = await example()
  let mode = 'initial'; let release!: (data: Snapshot) => void
  let started!: () => void
  const gate = new Promise<void>(resolve => { started = resolve })
  const drawn: (string | null | undefined)[] = []
  const host = bridge(async () => {
    if (mode === 'pending') { started(); return new Promise<Snapshot>(resolve => { release = resolve }) }
    if (mode === 'failed') throw Error('new workspace unavailable')
    return data
  })
  const state = new PanelState(); const session = connectPanel(host.api, () => { drawn.push(state.snapshot?.activeRoot) }, state)
  try {
    await session.reload(); await host.handlers.get('workspace.changed')!({ context })
    mode = 'pending'
    const pending = session.reload(); await gate
    const switched = host.handlers.get('workspace.changed')!({ context: { ...context, terminals: [] } })
    const start = drawn.length
    mode = 'failed'; release(data); await pending; await switched
    assert.equal(state.snapshot?.activeRoot, null)
    assert.ok(drawn.slice(start).every(root => root !== data.activeRoot))
    assert.equal(state.failed, true)
  } finally { session.dispose(); await f.close() }
})
