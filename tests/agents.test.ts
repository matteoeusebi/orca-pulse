import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { applyActivity } from '../src/activity'
import type { PlanView, Snapshot } from '../src/model'
import { PanelState, stepKey } from '../src/panel-state'
import { renderPanel } from '../src/panel-render'
import { readProject } from '../src/plans'
import * as workerModule from '../src/worker'
import { area, fixture, plan } from './helpers'
import { openPanel } from './page-harness'

const steps = [
  { id: 'build', title: 'Build', doneWhen: { manual: false }, work: { branch: 'feature/a' } },
  { id: 'ship', title: 'Ship', doneWhen: { manual: false } }
]
async function withAgents() {
  const f = await fixture()
  await f.write('plans/sample.plan.json', plan(steps))
  const result = await readProject(f.root)
  const plans = applyActivity(result.plans, [
    { root: f.root, branch: 'feature/a', state: 'done', name: 'Idle <one>', area: 'feature-a' },
    { root: f.root, branch: 'feature/a', state: 'working', name: null, area: 'feature-a' },
    { root: f.root, branch: 'main', state: 'waiting', name: '⠹ Orchestrator', area: 'main' },
    { root: f.root, branch: 'main', state: 'expired', name: 'Ghost', area: 'main' },
    { root: '/elsewhere', branch: 'feature/a', state: 'working', name: 'Stranger', area: 'x' }
  ])
  const data: Snapshot = { ...result, plans, activeRoot: f.root, activeName: 'Alba', workspaceKey: 'a', readAt: Date.now(), lastSuccessAt: Date.now(), truncated: false }
  return { f, data, view: plans[0] as PlanView }
}

test('a step lists the agents on its branch, working first; the rest of the project is listed once at plan level', async () => {
  const { f, view } = await withAgents()
  try {
    const [build, ship] = view.phases[0].steps
    assert.deepEqual(build.agents, [
      { name: 'feature-a', area: 'feature-a', state: 'working' },
      { name: 'Idle <one>', area: 'feature-a', state: 'done' }
    ])
    assert.equal(ship.agents, undefined)
    assert.deepEqual(view.agents, [{ name: 'Orchestrator', area: 'main', state: 'waiting' }])
    assert.equal(view.done, 0)
  } finally { await f.close() }
})

test('agent lists stay closed until asked, escape their text and close again with the workspace', async () => {
  const { f, data, view } = await withAgents()
  try {
    const state = new PanelState(); state.accept(data)
    const closed = renderPanel(state, 'en')
    assert.match(closed, /<button type="button" class="row step [^"]*" data-agents="[^"]+" aria-expanded="false">/)
    assert.equal((closed.match(/data-agents=/g) ?? []).length, 1)
    assert.doesNotMatch(closed, /class="row agent"/)
    assert.match(closed, /<div class="row step [^"]*">.*Ship/s)
    state.toggleAgents(stepKey(view, view.phases[0], view.phases[0].steps[0]))
    const open = renderPanel(state, 'en')
    assert.equal((open.match(/class="row agent"/g) ?? []).length, 2)
    assert.match(open, /Idle &lt;one&gt;.*idle/s)
    assert.doesNotMatch(open, /Orchestrator|Ghost|Stranger/)
    state.accept({ ...data, workspaceKey: 'b' })
    assert.doesNotMatch(renderPanel(state, 'en'), /class="row agent"/)
  } finally { await f.close() }
})

test('actual page opens and closes a step agent list with a click and keeps focus on it', async () => {
  const { f, data } = await withAgents()
  const page = await openPanel(data)
  try {
    const step = page.root.querySelector('button.step')!
    step.focus(); step.querySelector('.name')!.click()
    const opened = page.root.querySelector('button.step')!
    assert.equal(opened.getAttribute('aria-expanded'), 'true')
    assert.equal(page.document.activeElement, opened)
    assert.equal(page.root.querySelectorAll('.agent').length, 2)
    opened.click()
    assert.equal(page.root.querySelectorAll('.agent').length, 0)
  } finally { page.close(); await f.close() }
})

test('worker names agents from the focused list and from events of other workspaces', async () => {
  const f = await fixture()
  let worker
  try {
    await f.write('plans/sample.plan.json', plan(steps))
    await f.write('.git/worktrees/a/gitdir', '')
    const side = await f.write('side/.git', `gitdir: ${f.root}/.git/worktrees/a`)
    const main = area(f.root), other = { ...area(side.slice(0, -5), 'area-b', 'feature-a'), branch: 'feature/a' }
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [main, other], truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] },
      'agents.list': { agents: [{ terminalId: 'focus', title: null, agent: 'claude', state: 'working', stateStartedAt: 0 }] }
    } })
    worker = await mountWorker(workerModule, { host })
    await worker.emit('agent.status.changed', { paneKey: 'p', terminalId: 'far', workspaceId: other.id, title: 'Builder', state: 'working', receivedAt: Date.now() })
    const result = await worker.request('plans.read')
    const view = result.plans[0] as PlanView
    assert.deepEqual(view.phases[0].steps[0].agents, [{ name: 'Builder', area: 'feature-a', state: 'working' }])
    assert.deepEqual(view.agents, [{ name: 'claude', area: 'main', state: 'working' }])
  } finally { await worker?.deactivate(); await f.close() }
})
