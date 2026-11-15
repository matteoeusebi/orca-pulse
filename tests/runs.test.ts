import { assert, mockHost, mountWorker, test } from 'orca/testing'
import { external } from '../src/external'
import type { RunView, Snapshot } from '../src/model'
import { FINISHED_RUN_TTL_MS, parseRuns, parseTasks, parseTerminals, parseWorkers, runView, shortTitle } from '../src/orchestration'
import { PanelState } from '../src/panel-state'
import { renderPanel } from '../src/panel-render'
import * as workerModule from '../src/worker'
import { area, fixture } from './helpers'
import { openPanel } from './page-harness'

const now = Date.parse('2026-11-15T10:00:00Z')
const terminals = parseTerminals({ result: { terminals: [
  { handle: 'term_boss', worktreePath: '/p/site', title: '⠹ Boss' },
  { handle: 'term_w1', worktreePath: '/p/site-w1', title: 'Codex 2' },
  { handle: 'term_w2', worktreePath: '/p/site-w2', title: null }
] } })
const runs = parseRuns({ result: { runs: [
  { id: 'run_a', objective: '  Redo the pricing page\nwith a long second line', coordinator_handle: 'term_boss', created_at: '2026-11-15T09:00:00Z' },
  { id: 'run_gone', objective: 'Coordinator closed', coordinator_handle: 'term_closed', created_at: '2026-11-15T09:00:00Z' }
] } })
const tasks = parseTasks({ result: { tasks: [
  { id: 't1', status: 'completed', title: 'Research' },
  { id: 't2', status: 'dispatched', title: 'Comparison table' },
  { id: 't3', status: 'blocked', title: 'English copy' },
  { id: 't4', status: 'failed', title: 'Test payment' },
  { id: 't5', status: 'pending', title: 'Later <b>' },
  { id: 't6', status: 'dispatched', title: 'Needs an answer' }
] } })
const workers = parseWorkers({ result: { workers: [
  { taskId: 't2', agentTerminalHandle: 'term_w1', projection: { provider: { id: 'codex' }, attention: { requiresAction: false } } },
  { taskId: 't6', agentTerminalHandle: 'term_w2', projection: { provider: { id: 'claude' }, attention: { requiresAction: true } } },
  { taskId: 't1', agentTerminalHandle: 'term_w1', projection: {} },
  { taskId: 't4', agentTerminalHandle: 'term_closed', projection: { attention: { requiresAction: true } } },
  { taskId: 't3', agentTerminalHandle: 'term_closed', projection: { attention: { requiresAction: true } } }
] } })
const view = (): RunView => runView(runs[0], tasks, workers, terminals, now)!
const snapshot = (list: RunView[]): Snapshot => ({ plans: [], errors: [], activeRoot: '/p/site', activeName: 'site', workspaceKey: 'a',
  readAt: Date.now(), lastSuccessAt: Date.now(), truncated: false, runs: list })

test('a run counts its tasks, names the agent of a live terminal and puts what moves now first', () => {
  const run = view()
  assert.deepEqual([run.title, run.path, run.done, run.total, run.failed], ['Redo the pricing page', '/p/site', 1, 6, 1])
  assert.deepEqual(run.tasks.map(task => task.state), ['working', 'working', 'blocked', 'failed', 'queued', 'done'])
  assert.deepEqual(run.tasks[0].agent, { name: 'Codex 2', terminal: 'term_w1' })
  assert.deepEqual(run.tasks[1], { id: 't6', title: 'Needs an answer', state: 'working', agent: { name: 'claude', terminal: 'term_w2' }, needsYou: true })
  assert.deepEqual(run.tasks.find(task => task.id === 't4'), { id: 't4', title: 'Test payment', state: 'failed' })
  assert.equal(run.tasks.find(task => task.id === 't3')!.needsYou, undefined)
  assert.equal(run.tasks.find(task => task.id === 't1')!.agent, undefined)
})

test('a run without a live coordinator, without tasks, or finished long ago is not shown', () => {
  assert.equal(runView(runs[1], tasks, workers, terminals, now), null)
  assert.equal(runView(runs[0], [], workers, terminals, now), null)
  const finished = tasks.filter(task => task.id === 't1' || task.id === 't4')
  assert.ok(runView(runs[0], finished, [], terminals, now))
  assert.equal(runView(runs[0], finished, [], terminals, runs[0].createdAt + FINISHED_RUN_TTL_MS + 1), null)
  assert.equal(shortTitle('x'.repeat(300)).length, 120)
  assert.equal(shortTitle('\n## Brief:  redo   the page\nmore'), 'Brief: redo the page')
  assert.deepEqual([parseRuns(null), parseTasks({ result: {} }), parseWorkers('no'), parseTerminals({ result: { terminals: [1] } })], [[], [], [], []])
})

test('the section shows an unfinished run open, the one that waits first, done tasks folded, text escaped', () => {
  const state = new PanelState(); state.accept(snapshot([view()]))
  const html = renderPanel(state, 'it')
  assert.match(html, /<h1[^>]*>site<\/h1>.*Orchestrazioni.*Redo the pricing page.*1\/6/s)
  assert.doesNotMatch(html, /Nessun piano/)
  assert.match(html, /aria-expanded="true"[^>]*title="Redo the pricing page"/)
  assert.ok(html.indexOf('Needs an answer') < html.indexOf('Comparison table'))
  assert.match(html, /data-focus="term_w1">.*Comparison table.*Codex 2/s)
  assert.match(html, /English copy<\/span><span class="word">bloccato/)
  assert.match(html, /Test payment<\/span><span class="word">fallito/)
  assert.match(html, /Later &lt;b&gt;/)
  assert.match(html, /1 fatti/)
  assert.doesNotMatch(html, /Research/)
  state.toggle('run:run_a:done', false)
  assert.match(renderPanel(state, 'it'), /Research/)
  state.toggle('run:run_a', true)
  assert.doesNotMatch(renderPanel(state, 'it'), /Comparison table/)
})

test('actual page asks the worker to open the chat of a clicked agent', async () => {
  const page = await openPanel(snapshot([view()]))
  const asked: unknown[] = []
  const original = page.api.plugin.request
  page.api.plugin.request = (async (name: string, input: unknown) => {
    if (name === 'plans.focus') { asked.push(input); return { ok: true } }
    return original()
  }) as typeof original
  try {
    page.root.querySelector('button[data-focus="term_w1"]')!.click()
    assert.deepEqual(asked, [{ terminal: 'term_w1' }])
  } finally { page.close() }
})

test('worker shows only the runs coordinated from the focused project and refuses unknown terminals', async () => {
  const f = await fixture()
  const saved = { runs: external.orchestrations, focus: external.focusTerminal }
  let worker
  try {
    const here = { ...view(), path: f.root }, elsewhere = { ...view(), id: 'run_b', path: '/another' }
    external.orchestrations = async () => [here, elsewhere]
    const calls: string[] = []
    external.focusTerminal = async handle => { calls.push(handle); return handle === 'term_w1' }
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [area(f.root)], truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] },
      'agents.list': { agents: [] }
    } })
    worker = await mountWorker(workerModule, { host })
    const result = await worker.request('plans.read')
    assert.deepEqual(result.runs?.map(run => run.id), ['run_a'])
    assert.deepEqual(await worker.request('plans.focus', { terminal: 'term_w1' }), { ok: true })
    assert.deepEqual(await worker.request('plans.focus', { terminal: 'term_x' }), { ok: false })
    assert.deepEqual(await worker.request('plans.focus', {} as never), { ok: false })
    assert.deepEqual(await worker.request('plans.focus', { terminal: '--help' }), { ok: false })
    // Only a handle the panel was shown reaches Orca.
    assert.deepEqual(calls, ['term_w1'])
  } finally { external.orchestrations = saved.runs; external.focusTerminal = saved.focus; await worker?.deactivate(); await f.close() }
})

test('chats list who waits first, with state and time in separate columns and a way into each chat', async () => {
  const { projectChats } = await import('../src/activity')
  const minute = 60000, at = Date.now()
  const chats = projectChats([
    { root: '/p', branch: 'main', state: 'done', name: 'Blog images', area: 'main', terminal: 'term_3', since: at - 2 * 1440 * minute },
    { root: '/p', branch: 'main', state: 'working', name: '⠹ Contact form', area: 'main', terminal: 'term_1', since: at - 4 * minute },
    { root: '/p', branch: 'main', state: 'waiting', name: null, area: 'home', terminal: null, since: at - 125 * minute },
    { root: '/p', branch: 'main', state: 'working', name: 'A worker', area: 'w', terminal: 'term_w1' },
    { root: '/other', branch: 'main', state: 'working', name: 'Stranger', area: 'x', terminal: 'term_9' }
  ], '/p', new Set(['term_w1']))
  assert.deepEqual(chats.map(chat => [chat.name, chat.state, chat.terminal]), [['home', 'waiting', undefined], ['Contact form', 'working', 'term_1'], ['Blog images', 'done', 'term_3']])
  const state = new PanelState(); state.accept({ ...snapshot([]), runs: undefined, chats })
  const html = renderPanel(state, 'it')
  assert.match(html, /<h1[^>]*>site<\/h1>.*<h2 class="caption">Chat<\/h2>/s)
  assert.match(html, /<div class="row chat">.*home<\/span><span class="col state">aspetta te<\/span><span class="col time">2 h<\/span>/s)
  assert.match(html, /<button type="button" class="row chat" data-focus="term_1"[^>]*>.*Contact form.*al lavoro.*4 min/s)
  assert.match(html, /class="row chat idle" data-focus="term_3".*fermo.*2 g/s)
  assert.doesNotMatch(html, /Stranger|A worker|Nessun piano|[·•]/)
  const one = new PanelState(); one.accept({ ...snapshot([]), runs: undefined, chats: [{ name: 'Solo', area: 'main', state: 'working', since: at - 61 * minute }] })
  assert.match(renderPanel(one, 'en'), /1 hour</)
})

test('automations show the last outcome and the next run as a moment; the plan gets its own title below them', async () => {
  const { parseAutomations } = await import('../src/orchestration')
  const { when } = await import('../src/panel-rows')
  const { translator } = await import('../src/i18n')
  const noon = new Date(2026, 10, 15, 12, 0).getTime(), at = (day: number, hour: number, minute: number) => new Date(2026, 10, day, hour, minute).getTime()
  const list = parseAutomations({ result: {
    automations: [
      { id: 'a1', name: 'Morning check', runContext: { path: '/p/site' }, enabled: true, nextRunAt: at(16, 7, 30) },
      { id: 'a2', name: 'Weekly <report>', runContext: { path: '/p/site' }, enabled: true, nextRunAt: at(18, 8, 15) },
      { id: 'a3', name: 'Paused one', runContext: { path: '/elsewhere' }, enabled: false, nextRunAt: null },
      { name: 'no id' }
    ],
    items: [
      { automationId: 'a1', usageSummary: { lastRunStatus: 'completed' } },
      { automationId: 'a2', usageSummary: { lastRunStatus: 'skipped_precheck' } },
      { automationId: 'a3', usageSummary: { lastRunStatus: 'failed' } }
    ]
  } })
  assert.deepEqual(list.map(item => [item.id, item.path, item.enabled, item.last]), [['a1', '/p/site', true, 'ok'], ['a2', '/p/site', true, 'skipped'], ['a3', '/elsewhere', false, 'failed']])
  const t = translator('it')
  assert.equal(when(at(15, 18, 5), 'it', t, noon), 'oggi 18:05')
  assert.equal(when(at(16, 7, 30), 'it', t, noon), 'domani 07:30')
  assert.equal(when(at(18, 8, 15), 'it', t, noon), 'mercoledì 08:15')
  assert.match(when(at(30, 8, 15), 'it', t, noon), /^30 nov 08:15$/)
  const state = new PanelState(); state.accept({ ...snapshot([]), runs: undefined, automations: list })
  const html = renderPanel(state, 'it')
  assert.match(html, /Automazioni.*Morning check.*riuscita.*Weekly &lt;report&gt;.*saltata.*Paused one<\/span><span class="col state strong">fallita<\/span><span class="col next">in pausa/s)
  assert.doesNotMatch(html, /Nessun piano|class="caption">Piano/)
  // A next run that is already past is not shown as upcoming.
  const late = new PanelState(); late.accept({ ...snapshot([]), runs: undefined, automations: [{ ...list[0], nextRunAt: Date.now() - 60000 }] })
  assert.match(renderPanel(late, 'it'), /<span class="col next"><\/span>/)
})

test('worker keeps only the automations that run in a folder of the focused project', async () => {
  const f = await fixture()
  const saved = external.automations
  let worker
  try {
    const item = { id: 'a1', name: 'Here', path: f.root, enabled: true, nextRunAt: 1, last: null }
    external.automations = async () => [item, { ...item, id: 'a2', path: '/another' }, { ...item, id: 'a3', path: null }]
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces: [area(f.root)], truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] },
      'agents.list': { agents: [] }
    } })
    worker = await mountWorker(workerModule, { host })
    assert.deepEqual((await worker.request('plans.read')).automations?.map(a => a.id), ['a1'])
  } finally { external.automations = saved; await worker?.deactivate(); await f.close() }
})
