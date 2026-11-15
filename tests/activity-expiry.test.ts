import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as workerModule from '../src/worker'
import { area, fixture, plan } from './helpers'

for (const state of ['working', 'waiting', 'blocked'] as const) {
  test(`non-focused ${state} evidence expires after thirty minutes without erasing terminal identity`, async () => {
    const f = await fixture()
    const originalNow = Date.now
    let now = 1000000, worker
    Date.now = () => now
    try {
      await f.write('main/plans/sample.plan.json', plan([{ id: 'build', title: 'Build', work: { branch: 'feature/*' } }]))
      await mkdir(join(f.root, 'main/.git/worktrees/topic'), { recursive: true })
      await f.write('topic/.git', 'gitdir: ../main/.git/worktrees/topic')
      const main = area(join(f.root, 'main'), 'main', 'Project')
      const topic = { ...area(join(f.root, 'topic'), 'topic'), branch: 'feature/x' }
      const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
        'workspace.list': { workspaces: [main, topic], truncated: false },
        'workspace.readContext': { displayName: 'Project', branch: 'main', terminals: [{ id: 'focus' }] },
        'agents.list': { agents: [] }
      } })
      worker = await mountWorker(workerModule, { host })
      const event = { paneKey: 'other', terminalId: 'other', workspaceId: topic.id, state, receivedAt: now }
      await worker.emit('agent.status.changed', event)
      const read = async () => {
        const p = (await worker!.request('plans.read')).plans[0]
        assert.ok(p.kind === 'plan'); return p
      }
      now += 60000
      let p = await read()
      assert.equal(!!p.phases[0].steps[0].working, state === 'working')
      assert.equal(p.phases[0].steps[0].waiting, state !== 'working')
      now = event.receivedAt + 1799999
      p = await read()
      assert.equal(!!p.phases[0].steps[0].working, state === 'working')
      assert.equal(p.phases[0].steps[0].waiting, state !== 'working')
      now++
      p = await read()
      assert.equal(!!p.phases[0].steps[0].working, false)
      assert.equal(p.phases[0].steps[0].waiting, false)
      assert.equal(p.phases[0].state, 'notStarted')
      // Going back in time cannot resurrect a dropped state.
      now--
      assert.equal(!!(await read()).phases[0].steps[0].working, false)
      assert.equal((await read()).phases[0].steps[0].waiting, false)
      host.respond('workspace.readContext', { displayName: 'Unresolved name', branch: topic.branch, terminals: [{ id: 'other' }] })
      assert.equal((await worker.request('plans.read')).workspaceKey, topic.id)
      host.respond('workspace.readContext', { displayName: 'Project', branch: 'main', terminals: [{ id: 'focus' }] })
      await worker.emit('agent.status.changed', { ...event, receivedAt: now })
      p = await read()
      assert.equal(!!p.phases[0].steps[0].working, state === 'working')
      assert.equal(p.phases[0].steps[0].waiting, state !== 'working')
      host.respond('workspace.list', { workspaces: [main], truncated: false })
      await read()
      host.respond('workspace.list', { workspaces: [main, topic], truncated: false })
      p = await read()
      assert.equal(!!p.phases[0].steps[0].working, false)
      assert.equal(p.phases[0].steps[0].waiting, false)
    } finally { Date.now = originalNow; await worker?.deactivate(); await f.close() }
  })
}

test('fresh focused agents remain visible beyond the event expiry window', async () => {
  const f = await fixture()
  const originalNow = Date.now
  let now = 1000000, worker
  Date.now = () => now
  try {
    await f.write('plans/sample.plan.json', plan([{ id: 'build', title: 'Build', work: { branch: 'main' } }]))
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [area(f.root)], truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] },
      'agents.list': { agents: [{ terminalId: 'focus', state: 'working', title: null, agent: null, stateStartedAt: now }] }
    } })
    worker = await mountWorker(workerModule, { host })
    await worker.request('plans.read'); now += 3600000
    const snapshot = await worker.request('plans.read')
    const p = snapshot.plans[0]; assert.ok(p.kind === 'plan')
    assert.equal(p.phases[0].steps[0].working, true)
    assert.equal(Object.hasOwn(snapshot, 'working'), false)
  } finally { Date.now = originalNow; await worker?.deactivate(); await f.close() }
})
