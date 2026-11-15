import assert from 'node:assert/strict'
import { mockHost, mountWorker, test } from 'orca/testing'
import * as workerModule from '../src/worker'
import { area, fixture, plan } from './helpers'
import { openPanel } from './page-harness'

test('actual page shows waiting steps and header work together, then follows fresh worker activity and freshness', async () => {
  const f = await fixture()
  let worker, page: Awaited<ReturnType<typeof openPanel>> | undefined
  try {
    await f.write('plans/sample.plan.json', plan([{ id: 'build', title: 'Build', work: { branch: 'main' } }]))
    await f.write('plans/other.plan.json', { ...plan(), id: 'other', title: 'Finished' })
    const agent = (state: 'working' | 'waiting' | 'blocked') => ({ terminalId: 'focus', state, title: null, agent: null, stateStartedAt: 0 })
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [area(f.root)], truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] },
      'agents.list': { agents: [agent('waiting'), agent('working')] }
    } })
    worker = await mountWorker(workerModule, { host })
    const read = async () => {
      const snapshot = await worker!.request('plans.read')
      // Keep the unfinished plan first, as the project view displays its first plan.
      snapshot.plans.reverse()
      return snapshot
    }
    page = await openPanel(await read())
    for (const waiting of ['waiting', 'blocked'] as const) {
      host.respond('agents.list', { agents: [agent(waiting), agent('working')] })
      page.page.snapshot = await read(); await page.poll()
      assert.equal(page.root.querySelectorAll('.step.waiting').length, 1)
      assert.equal(page.root.querySelectorAll('.phase .waiting-mark').length, 1)
      assert.equal(page.root.querySelectorAll('.step .spinner').length, 0)
      assert.equal(page.root.querySelectorAll('header .spinner').length, 1)
    }
    host.respond('agents.list', { agents: [agent('working')] })
    page.page.snapshot = await read(); await page.poll()
    assert.equal(page.root.querySelectorAll('.step .spinner').length, 1)
    assert.equal(page.root.querySelectorAll('header .spinner').length, 0)
    assert.equal(page.root.querySelectorAll('.step.waiting').length, 0)
    page.page.failed = true; await page.poll()
    assert.equal(page.root.querySelectorAll('.spinner').length, 0)
    page.page.failed = false
    page.page.snapshot = { ...await read(), lastSuccessAt: Date.now() - 61000 }; await page.poll()
    assert.equal(page.root.querySelectorAll('.spinner').length, 0)
    page.page.snapshot = await read(); await page.poll()
    assert.equal(page.root.querySelectorAll('.step .spinner').length, 1)
    host.respond('agents.list', { agents: [] })
    page.page.snapshot = await read(); await page.poll()
    assert.equal(page.root.querySelectorAll('.spinner').length, 0)
    // Finished overview rows remain without activity.
    await page.emit('workspace.changed', { context: null })
    page.page.snapshot = { ...await read(), activeRoot: null, workspaceKey: null }; await page.poll()
    assert.equal(page.root.querySelectorAll('.plan.done .spinner').length, 0)
  } finally { page?.close(); await worker?.deactivate(); await f.close() }
})
