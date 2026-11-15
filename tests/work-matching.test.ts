import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { mockHost, mountWorker, test } from 'orca/testing'
import * as workerModule from '../src/worker'
import { area, fixture, plan } from './helpers'
import { openPanel } from './page-harness'

test('real workspace branches drive step spinners, header fallback and owner waiting on each read', async () => {
  const f = await fixture()
  let worker, page: Awaited<ReturnType<typeof openPanel>> | undefined
  try {
    const source = plan([
      { id: 'done', title: 'Already done', doneWhen: { manual: true }, work: { branch: 'feature/*' } },
      { id: 'next', title: 'Unrelated current step', doneWhen: { file: 'report.md' } }
    ])
    source.phases.push({ id: 'feature', title: 'Feature phase', steps: [
      { id: 'build', title: 'Branch task', doneWhen: { file: 'build.txt' }, work: { branch: 'feature/*' } }
    ] })
    await f.write('main/plans/sample.plan.json', source)
    await mkdir(join(f.root, 'main/.git/worktrees/topic'), { recursive: true })
    await f.write('topic/.git', 'gitdir: ../main/.git/worktrees/topic')
    await f.write('other/plans/sample.plan.json', plan())
    const a = area(join(f.root, 'main'), 'a', 'Project')
    const topic = { ...area(join(f.root, 'topic'), 'topic', 'Feature'), branch: 'feature/build' }
    const other = { ...area(join(f.root, 'other'), 'other', 'Other'), branch: topic.branch }
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [a, topic, other], truncated: false },
      'workspace.readContext': { displayName: 'Project', branch: 'main', terminals: [{ id: 'focused' }] },
      'agents.list': { agents: [{ terminalId: 'focused', state: 'working', title: null, agent: 'codex', stateStartedAt: 0 }] }
    } })
    worker = await mountWorker(workerModule, { host })
    page = await openPanel(await worker.request('plans.read'))
    assert.equal(page.root.querySelectorAll('header .spinner').length, 1)
    assert.equal(page.root.querySelectorAll('.step .spinner').length, 0)
    host.respond('agents.list', { agents: [] })
    const emit = async (workspaceId: string, state: 'working' | 'waiting' | 'blocked' | 'done') => {
      await worker!.emit('agent.status.changed', { paneKey: workspaceId, workspaceId, state, receivedAt: Date.now() })
      page!.page.snapshot = await worker!.request('plans.read'); await page!.poll()
    }
    await emit(other.id, 'working')
    assert.equal(page.root.querySelectorAll('.spinner').length, 0)
    await emit(topic.id, 'working')
    page.root.querySelectorAll('button[data-phase]')[1].click()
    assert.equal(page.root.querySelectorAll('header .spinner').length, 0)
    assert.equal(page.root.querySelectorAll('.step .spinner').length, 1)
    assert.equal(page.root.querySelectorAll('.step.done .spinner').length, 0)
    page.root.querySelectorAll('button[data-phase]')[1].click()
    for (const state of ['waiting', 'blocked'] as const) {
      await emit(topic.id, state)
      assert.equal(page.root.querySelectorAll('.spinner').length, 0)
      assert.equal(page.root.querySelectorAll('.phase .waiting-mark').length, 1)
      assert.equal(page.root.querySelectorAll('.step.waiting').length, 1)
      assert.equal(page.root.querySelectorAll('button[data-phase]')[1].getAttribute('aria-expanded'), 'true')
    }
    await emit(topic.id, 'done')
    assert.equal(page.root.querySelectorAll('.step.waiting').length, 0)
    await f.write('main/build.txt')
    await emit(topic.id, 'working')
    assert.equal(page.root.querySelectorAll('.step .spinner').length, 0)
    assert.equal(page.root.querySelectorAll('header .spinner').length, 1)
    await worker.emit('workspace.removed', { workspaceId: topic.id, path: topic.path, kind: 'worktree' })
    page.page.snapshot = await worker.request('plans.read'); await page.poll()
    assert.equal(page.root.querySelectorAll('.spinner').length, 0)
  } finally { page?.close(); await worker?.deactivate(); await f.close() }
})
