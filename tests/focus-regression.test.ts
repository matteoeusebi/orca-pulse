import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as workerModule from '../src/worker'
import { area, fixture, plan } from './helpers'

for (const displayName of ['main', 'Director', 'Renamed']) {
  test(`foreign agent events cannot select or clear focused ${displayName}`, async () => {
    const f = await fixture()
    let worker
    try {
      await f.write('a/plans/sample.plan.json', plan())
      await f.write('b/plans/sample.plan.json', plan())
      const a = { ...area(join(f.root, 'a'), 'a'), project: 'Director' }
      const b = { ...area(join(f.root, 'b'), 'b'), project: 'Gateway' }
      const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
        'workspace.list': { workspaces: [a, b], truncated: false },
        'workspace.readContext': { displayName, branch: 'main', terminals: [{ id: 'focused-chat' }] },
        'agents.list': { agents: [] }
      } })
      worker = await mountWorker(workerModule, { host })
      const expected = displayName === 'Director' ? a.path : null
      assert.equal((await worker.request('plans.read')).activeRoot, expected)
      for (const terminalId of ['foreign-chat', 'another-foreign-chat']) {
        for (const workspaceId of [b.id, `legacy::${b.path}`, null, a.id]) {
          await worker.emit('agent.status.changed', { paneKey: terminalId, terminalId, workspaceId, state: 'working', receivedAt: 1 })
          assert.equal((await worker.request('plans.read')).activeRoot, expected)
        }
      }
      await worker.emit('workspace.removed', { workspaceId: b.id, path: b.path, kind: 'worktree' })
      assert.equal((await worker.request('plans.read')).activeRoot, expected)
      host.respond('workspace.readContext', { displayName: 'Gateway', branch: 'main', terminals: [] })
      assert.equal((await worker.request('plans.read')).activeRoot, b.path)
    } finally { await worker?.deactivate(); await f.close() }
  })
}

test('name fallback survives ambiguous metadata until membership replaces it, and disjoint terminals clear identity', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('a/plans/sample.plan.json', plan())
    await f.write('b/plans/sample.plan.json', plan())
    const a = { ...area(join(f.root, 'a'), 'a'), project: 'Director' }
    const b = area(join(f.root, 'b'), 'b')
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [a, b], truncated: false },
      'workspace.readContext': { displayName: 'Director', branch: 'main', terminals: [{ id: 'a-chat' }] }
    } })
    worker = await mountWorker(workerModule, { host })
    assert.equal((await worker.request('plans.read')).activeRoot, a.path)
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [{ id: 'a-chat' }, { id: 'new-chat' }] })
    assert.equal((await worker.request('plans.read')).activeRoot, a.path)
    await worker.emit('agent.status.changed', { paneKey: 'a-chat', terminalId: 'a-chat', workspaceId: b.id, state: 'working', receivedAt: 1 })
    assert.equal((await worker.request('plans.read')).activeRoot, b.path)
    host.respond('workspace.readContext', () => { throw Error('temporary context failure') })
    await assert.rejects(worker.request('plans.read'))
    for (const terminals of [[], [{ id: 'b-chat' }]]) {
      host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals })
      assert.equal((await worker.request('plans.read')).activeRoot, null)
    }
  } finally { await worker?.deactivate(); await f.close() }
})
