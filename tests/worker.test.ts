import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as workerModule from '../src/worker'
import type { Snapshot } from '../src/model'
import { area, fixture, plan } from './helpers'

test('worker reads each main checkout once and follows focus without writing host state', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('alpha/plans/sample.plan.json', plan())
    await f.write('beta/plans/sample.plan.json', { ...plan(), title: 'Zenit' })
    await mkdir(join(f.root, 'alpha/.git/worktrees/topic'), { recursive: true })
    await f.write('topic/.git', 'gitdir: ../alpha/.git/worktrees/topic')
    const a = area(join(f.root, 'alpha'), 'a', 'Alpha')
    const b = area(join(f.root, 'beta'), 'b', 'Beta')
    const w = area(join(f.root, 'topic'), 'w', 'Topic')
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [a, b, w], truncated: false },
      'workspace.readContext': { displayName: 'Alpha', branch: 'main', terminals: [] }
    } })
    worker = await mountWorker(workerModule, { host })
    const first = await worker.request('plans.read') as any
    assert.equal(first.plans.length, 2)
    assert.equal(first.activeRoot, a.path)
    host.respond('workspace.readContext', { displayName: 'Topic', branch: 'main', terminals: [] })
    assert.equal((await worker.request('plans.read') as any).activeRoot, a.path)
    host.respond('workspace.readContext', { displayName: 'Beta', branch: 'main', terminals: [] })
    assert.equal((await worker.request('plans.read') as any).activeRoot, b.path)
    host.respond('workspace.readContext', null)
    assert.equal((await worker.request('plans.read') as any).activeRoot, null)
    assert.deepEqual(worker.refusals, [])
    assert.deepEqual(host.data(), { storage: {}, settings: {}, secrets: {} })
  } finally { await worker?.deactivate(); await f.close() }
})

test('remote workspaces cannot be mistaken for local paths; unreadable roots do not hide healthy plans', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('local/plans/sample.plan.json', plan())
    await f.write('remote/plans/sample.plan.json', { ...plan(), title: 'Remote secret' })
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [area(join(f.root, 'local')), { ...area(join(f.root, 'remote'), 'remote'), hostId: 'ssh:x' }, area(join(f.root, 'absent'), 'missing')], truncated: false },
      'workspace.readContext': null
    } })
    worker = await mountWorker(workerModule, { host })
    const result = await worker.request('plans.read') as any
    assert.deepEqual(result.plans.map((p: any) => p.title), ['Alba'])
    assert.equal(result.errors.length, 2)
    assert.equal(result.activeRoot, null)
  } finally { await worker?.deactivate(); await f.close() }
})

test('successful discovery advances freshness despite remote and missing projects; truncation does not', async () => {
  const f = await fixture()
  const originalNow = Date.now
  let now = 1000
  Date.now = () => now
  let worker
  try {
    await f.write('local/plans/sample.plan.json', plan())
    const workspaces = [area(join(f.root, 'local')), { ...area('/remote/project', 'remote'), hostId: 'ssh:x' }, area(join(f.root, 'missing'), 'missing')]
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces, truncated: false }, 'workspace.readContext': null
    } })
    worker = await mountWorker(workerModule, { host })
    const first = await worker.request('plans.read')
    assert.equal(first.lastSuccessAt, 1000)
    assert.equal(first.errors.length, 2)
    now = 2000
    const next = await worker.request('plans.read')
    assert.equal(next.lastSuccessAt, 2000)
    assert.equal(next.plans.length, 1)
    host.respond('workspace.list', { workspaces, truncated: true })
    now = 3000
    assert.equal((await worker.request('plans.read')).lastSuccessAt, 2000)
  } finally { Date.now = originalNow; await worker?.deactivate(); await f.close() }
})

test('overlapping worker requests share one read and the next request reads fresh context', async () => {
  const f = await fixture()
  let worker
  let release!: () => void
  let started!: () => void
  const pending = new Promise<void>((resolve) => { started = resolve })
  const gate = new Promise<void>((resolve) => { release = resolve })
  try {
    await f.write('plans/sample.plan.json', plan())
    const workspaces = [area(f.root)]
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': async () => { started(); await gate; return { workspaces, truncated: false } },
      'workspace.readContext': null
    } })
    worker = await mountWorker(workerModule, { host })
    const first = worker.request('plans.read')
    await pending
    const second = worker.request('plans.read')
    release()
    const answers = await Promise.all([first, second])
    assert.equal(host.callsOf('workspace.list').length, 1)
    assert.equal(answers[0].plans.length, 1)
    assert.deepEqual(answers[0], answers[1])
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [] })
    assert.equal((await worker.request('plans.read')).activeRoot, f.root)
    assert.equal(host.callsOf('workspace.list').length, 2)
  } finally { release(); await worker?.deactivate(); await f.close() }
})

test('hostId local and null both read the local workspace plan', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('plans/sample.plan.json', plan())
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [] }
    } })
    worker = await mountWorker(workerModule, { host })
    for (const hostId of ['local', null]) {
      host.respond('workspace.list', { workspaces: [{ ...area(f.root), hostId }], truncated: false })
      const result: Snapshot = await worker.request('plans.read')
      assert.deepEqual(result.plans.map((plan) => plan.title), ['Alba'])
      assert.equal(result.activeRoot, f.root)
      assert.deepEqual(result.errors, [])
    }
  } finally { await worker?.deactivate(); await f.close() }
})

test('hostId ssh:x and other remote IDs never read a coincident local path', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('plans/sample.plan.json', plan())
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [] }
    } })
    worker = await mountWorker(workerModule, { host })
    for (const hostId of ['ssh:x', 'runtime:x', 'unknown-host']) {
      host.respond('workspace.list', { workspaces: [{ ...area(f.root), hostId }], truncated: false })
      const result: Snapshot = await worker.request('plans.read')
      assert.deepEqual(result.plans, [])
      assert.equal(result.activeRoot, null)
      assert.deepEqual(result.errors, [{ file: f.root, reason: 'remote' }])
    }
  } finally { await worker?.deactivate(); await f.close() }
})

test('real member status events resolve duplicate names and supply activity when agent listing is unavailable', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('a/plans/sample.plan.json', plan([{ id: 'first', title: 'First', doneWhen: { manual: false } }]))
    await f.write('b/plans/sample.plan.json', plan())
    const a = area(join(f.root, 'a'), 'identity:a')
    const b = area(join(f.root, 'b'), 'identity:b')
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [a, b], truncated: false },
      'agents.list': () => { throw Error('temporarily unavailable') },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] }
    } })
    worker = await mountWorker(workerModule, { host })
    const headerWorking = (snapshot: Snapshot) => snapshot.plans.some(p => p.kind === 'plan' && p.working)
    assert.equal((await worker.request('plans.read')).activeRoot, null)
    const event = { terminalId: 'focus', workspaceId: a.id, paneKey: 'pane', state: 'working' as const, receivedAt: 1 }
    await worker.emit('agent.status.changed', event)
    let result = await worker.request('plans.read')
    assert.equal(result.activeRoot, a.path)
    assert.equal(headerWorking(result), true)
    host.respond('workspace.readContext', { displayName: 'Director', branch: 'main', terminals: [{ id: 'focus' }] })
    host.respond('workspace.list', { workspaces: [{ ...a, project: 'Director' }, b], truncated: false })
    assert.equal(headerWorking(await worker.request('plans.read')), true)
    await worker.emit('agent.status.changed', { ...event, state: 'waiting', receivedAt: 2 })
    assert.equal(headerWorking(await worker.request('plans.read')), false)
    await worker.emit('agent.status.changed', { ...event, receivedAt: 3 })
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [] })
    result = await worker.request('plans.read')
    assert.equal(result.activeRoot, null)
    assert.equal(headerWorking(result), false)
    assert.deepEqual(worker.refusals, [])
  } finally { await worker?.deactivate(); await f.close() }
})
