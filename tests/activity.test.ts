import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import type { Snapshot } from '../src/model'
import * as workerModule from '../src/worker'
import { area, fixture, plan } from './helpers'

const agent = (terminalId: string | null, state: 'working' | 'waiting' = 'working') =>
  ({ terminalId, state, title: 'Not identity evidence', agent: 'codex', stateStartedAt: 0 })

const unfinished = () => plan([{ id: 'first', title: 'First', doneWhen: { manual: false } }])
const headerWorking = (snapshot: Snapshot) => snapshot.plans.some(p => p.kind === 'plan' && p.working)

test('cold worker reads current agents and uses only working terminals in the focused context', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('plans/sample.plan.json', unfinished())
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [area(f.root)], truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] },
      'agents.list': { agents: [agent('focus')] }
    } })
    worker = await mountWorker(workerModule, { host })
    assert.equal(headerWorking(await worker.request('plans.read')), true)
    for (const agents of [[agent('other')], [agent(null)], [agent('focus', 'waiting')], []]) {
      host.respond('agents.list', { agents })
      assert.equal(headerWorking(await worker.request('plans.read')), false)
    }
    host.respond('agents.list', { agents: [agent('focus', 'waiting'), agent('focus')] })
    assert.equal(headerWorking(await worker.request('plans.read')), true)
    assert.equal(host.callsOf('agents.list').length, 6)
    assert.deepEqual(worker.refusals, [])
  } finally { await worker?.deactivate(); await f.close() }
})

test('agents.list proves activity but cannot join opaque terminals to duplicate workspace names at cold start', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('a/plans/sample.plan.json', unfinished())
    await f.write('b/plans/sample.plan.json', unfinished())
    const a = { ...area(join(f.root, 'a'), 'a'), project: 'Director' }
    const b = { ...area(join(f.root, 'b'), 'b'), project: 'Gateway' }
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [a, b], truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'opaque' }] },
      'agents.list': { agents: [{ ...agent('opaque'), title: 'Director' }] }
    } })
    worker = await mountWorker(workerModule, { host })
    const result = await worker.request('plans.read')
    assert.equal(result.activeRoot, null)
    assert.equal(headerWorking(result), false)
    host.respond('workspace.readContext', { displayName: 'Director', branch: 'main', terminals: [{ id: 'opaque' }] })
    const identified = await worker.request('plans.read')
    assert.equal(identified.activeRoot, a.path)
    assert.equal(headerWorking(identified), true)
    assert.deepEqual(worker.refusals, [])
  } finally { await worker?.deactivate(); await f.close() }
})

test('split-pane events remain independent when agents.list is unavailable; fresh list replaces stale activity', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('plans/sample.plan.json', unfinished())
    const a = area(f.root)
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [a], truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] },
      'agents.list': () => { throw Error('temporarily unavailable') }
    } })
    worker = await mountWorker(workerModule, { host })
    const event = { terminalId: 'focus', workspaceId: a.id, state: 'working' as const, receivedAt: 1 }
    await worker.emit('agent.status.changed', { ...event, paneKey: 'left' })
    await worker.emit('agent.status.changed', { ...event, paneKey: 'right', state: 'waiting' })
    assert.equal(headerWorking(await worker.request('plans.read')), true)
    await worker.emit('agent.status.changed', { ...event, paneKey: 'right', workspaceId: null })
    assert.equal(headerWorking(await worker.request('plans.read')), true)
    await worker.emit('agent.status.changed', { ...event, paneKey: 'left', state: 'done' })
    assert.equal(headerWorking(await worker.request('plans.read')), false)
    await worker.emit('agent.status.changed', { ...event, paneKey: 'left' })
    host.respond('agents.list', { agents: [agent('focus', 'waiting')] })
    assert.equal(headerWorking(await worker.request('plans.read')), false)
  } finally { await worker?.deactivate(); await f.close() }
})
