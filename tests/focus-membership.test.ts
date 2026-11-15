import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as workerModule from '../src/worker'
import { area, fixture, plan } from './helpers'

async function setup() {
  const f = await fixture()
  const workspaces = Array.from({ length: 8 }, (_, i) => ({
    ...area(join(f.root, `project-${i}`), `area-${i}`), project: i === 0 ? 'Director' : `Project ${i}`
  }))
  try {
    for (const area of workspaces) await f.write(`${area.path.slice(f.root.length + 1)}/plans/sample.plan.json`, plan())
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces, truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focused-chat' }] },
      'agents.list': { agents: [] }
    } })
    const worker = await mountWorker(workerModule, { host })
    return { f, host, worker, workspaces, async close() { await worker.deactivate(); await f.close() } }
  } catch (error) { await f.close(); throw error }
}

test('focused terminal membership resolves the root among eight main/main workspaces', async () => {
  const { worker, workspaces, close } = await setup()
  try {
    assert.equal((await worker.request('plans.read')).activeRoot, null)
    // Membership proves identity even when the agent is done and agents.list is empty.
    await worker.emit('agent.status.changed', {
      paneKey: 'focus', terminalId: 'focused-chat', workspaceId: `legacy::${workspaces[0].path}`, state: 'done', receivedAt: 1
    })
    const result = await worker.request('plans.read')
    assert.equal(result.activeRoot, workspaces[0].path)
    assert.equal(result.workspaceKey, workspaces[0].id)
    assert.ok(result.plans.every(p => p.kind !== 'plan' || !p.working))
  } finally { await close() }
})

test('events outside the focused terminal list neither resolve an ambiguous root nor change a known root', async () => {
  const { host, worker, workspaces, close } = await setup()
  try {
    const event = { paneKey: 'foreign', terminalId: 'foreign-chat', workspaceId: workspaces[1].id, state: 'working' as const, receivedAt: 1 }
    await worker.emit('agent.status.changed', event)
    assert.equal((await worker.request('plans.read')).activeRoot, null)
    host.respond('workspace.readContext', { displayName: 'Director', branch: 'main', terminals: [{ id: 'focused-chat' }] })
    assert.equal((await worker.request('plans.read')).activeRoot, workspaces[0].path)
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [{ id: 'focused-chat' }] })
    for (const workspaceId of [workspaces[2].id, `legacy::${workspaces[3].path}`, null]) {
      await worker.emit('agent.status.changed', { ...event, workspaceId })
      assert.equal((await worker.request('plans.read')).activeRoot, workspaces[0].path)
    }
  } finally { await close() }
})

test('membership identity persists through event loss and metadata changes until focused terminals stop overlapping', async () => {
  const { host, worker, workspaces, close } = await setup()
  try {
    const event = { paneKey: 'focus', terminalId: 'focused-chat', workspaceId: workspaces[0].id, state: 'working' as const, receivedAt: 1 }
    await worker.emit('agent.status.changed', event)
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[0].id)
    await worker.emit('agent.status.changed', { ...event, workspaceId: null })
    host.respond('workspace.readContext', { displayName: 'Project 1', branch: 'main', terminals: [{ id: 'focused-chat' }, { id: 'added-chat' }] })
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[0].id)
    await worker.emit('agent.status.changed', { ...event, workspaceId: workspaces[1].id })
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[0].id)
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [{ id: 'added-chat' }] })
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[0].id)
    await worker.emit('agent.status.changed', { paneKey: 'other', terminalId: 'other-chat', workspaceId: workspaces[2].id, state: 'waiting', receivedAt: 2 })
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [{ id: 'other-chat' }] })
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[2].id)
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [] })
    assert.equal((await worker.request('plans.read')).activeRoot, null)
  } finally { await close() }
})

test('membership proof replaces a name fallback, then survives conflicting later events while terminals overlap', async () => {
  const { host, worker, workspaces, close } = await setup()
  try {
    host.respond('workspace.readContext', { displayName: 'Director', branch: 'main', terminals: [{ id: 'focused-chat' }] })
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[0].id)
    const event = { paneKey: 'member', terminalId: 'focused-chat', workspaceId: workspaces[1].id, state: 'waiting' as const, receivedAt: Date.now() }
    await worker.emit('agent.status.changed', event)
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[1].id)
    await worker.emit('agent.status.changed', { ...event, workspaceId: workspaces[0].id })
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[1].id)
    await worker.emit('agent.status.changed', { ...event, workspaceId: null })
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[1].id)
  } finally { await close() }
})

test('conflicting member mappings, missing terminal IDs and unknown workspaces cannot establish focus', async () => {
  const { worker, workspaces, close } = await setup()
  try {
    const event = { paneKey: 'one', workspaceId: workspaces[0].id, state: 'working' as const, receivedAt: 1 }
    await worker.emit('agent.status.changed', event)
    assert.equal((await worker.request('plans.read')).activeRoot, null)
    await worker.emit('agent.status.changed', { ...event, terminalId: 'focused-chat', workspaceId: 'unlisted' })
    assert.equal((await worker.request('plans.read')).activeRoot, null)
    await worker.emit('agent.status.changed', { ...event, terminalId: 'focused-chat' })
    await worker.emit('agent.status.changed', { ...event, paneKey: 'two', terminalId: 'focused-chat', workspaceId: workspaces[1].id })
    assert.equal((await worker.request('plans.read')).activeRoot, null)
    await worker.emit('agent.status.changed', { ...event, paneKey: 'two', terminalId: 'focused-chat', workspaceId: `legacy::${workspaces[0].path}` })
    assert.equal((await worker.request('plans.read')).workspaceKey, workspaces[0].id)
  } finally { await close() }
})
