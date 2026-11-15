import { join } from 'node:path'
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as workerModule from '../src/worker'
import { external, parseResources, parseResourcesCommand, parseTerminalPaths } from '../src/external'
import { area, fixture, plan } from './helpers'

test('a cold panel finds the focused project from the terminal folder, with no agent event', async () => {
  const f = await fixture()
  const previous = { ...external }
  let worker
  try {
    const workspaces = Array.from({ length: 8 }, (_, i) => area(join(f.root, `project-${i}`), `area-${i}`))
    for (const item of workspaces) await f.write(`${item.path.slice(f.root.length + 1)}/plans/sample.plan.json`, plan())
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces, truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'idle-chat' }] },
      'agents.list': { agents: [] }
    } })
    let calls = 0
    external.terminalPaths = async () => { calls++; return new Map([['idle-chat', workspaces[3].path], ['elsewhere', workspaces[5].path]]) }
    external.resources = async () => ({ light: 'yellow', used: 3, max: 4 })
    worker = await mountWorker(workerModule, { host })
    const first = await worker.request('plans.read') as any
    assert.equal(first.activeRoot, workspaces[3].path)
    assert.equal(first.workspaceKey, workspaces[3].id)
    assert.deepEqual(first.resources, { light: 'yellow', used: 3, max: 4 })
    await worker.request('plans.read')
    assert.equal(calls, 1, 'a known terminal is not looked up again')
    // The focus moves to a terminal the CLI does not know: no guess, no stale project.
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [{ id: 'unknown-chat' }] })
    external.terminalPaths = async () => new Map()
    assert.equal((await worker.request('plans.read') as any).activeRoot, null)
    // Two terminals of one context in different folders prove nothing.
    host.respond('workspace.readContext', { displayName: 'main', branch: 'main', terminals: [{ id: 'x' }, { id: 'y' }] })
    external.terminalPaths = async () => new Map([['x', workspaces[1].path], ['y', workspaces[2].path]])
    assert.equal((await worker.request('plans.read') as any).activeRoot, null)
  } finally { Object.assign(external, previous); await worker?.deactivate(); await f.close() }
})

test('a lookup that fails is retried later instead of marking the terminal unknown', async () => {
  const f = await fixture()
  const previous = { ...external }
  const originalNow = Date.now
  let now = originalNow()
  Date.now = () => now
  let worker
  try {
    const workspaces = Array.from({ length: 3 }, (_, i) => area(join(f.root, `project-${i}`), `area-${i}`))
    for (const item of workspaces) await f.write(`${item.path.slice(f.root.length + 1)}/plans/sample.plan.json`, plan())
    const host = mockHost({ capabilities: ['workspace:read', 'agent:read'], results: {
      'workspace.list': { workspaces, truncated: false },
      'workspace.readContext': { displayName: 'main', branch: 'main', terminals: [{ id: 'chat' }] },
      'agents.list': { agents: [] }
    } })
    let calls = 0; let answer: Map<string, string> | null = null
    external.terminalPaths = async () => { calls++; return answer }
    worker = await mountWorker(workerModule, { host })
    assert.equal((await worker.request('plans.read') as any).activeRoot, null)
    answer = new Map([['chat', workspaces[2].path]])
    assert.equal((await worker.request('plans.read') as any).activeRoot, null)
    assert.equal(calls, 1, 'no new process during the wait')
    now += 15000
    assert.equal((await worker.request('plans.read') as any).activeRoot, workspaces[2].path)
    assert.equal(calls, 2)
  } finally { Date.now = originalNow; Object.assign(external, previous); await worker?.deactivate(); await f.close() }
})

test('external answers are validated: malformed data yields nothing', () => {
  const list = { result: { terminals: [{ handle: 'term_a', worktreePath: '/p/a' }, { handle: 7, worktreePath: '/p/b' }, { handle: 'term_c' }] } }
  assert.deepEqual([...parseTerminalPaths(list)], [['term_a', '/p/a']])
  assert.equal(parseTerminalPaths(null).size, 0)
  assert.equal(parseTerminalPaths({ result: { terminals: 'no' } }).size, 0)
  assert.deepEqual(parseResources({ light: 'yellow', used: 4, max: 4 }), { light: 'yellow', used: 4, max: 4 })
  assert.deepEqual(parseResources({ light: 'green', used: 0, max: 4, extra: 1 }), { light: 'green', used: 0, max: 4 })
  for (const bad of [null, {}, { light: 'blue', used: 1, max: 4 }, { light: 'green', used: -1, max: 4 },
    { light: 'green', used: '1', max: 4 }, { light: 'green', used: 1, max: 0 }]) assert.equal(parseResources(bad), null)
  assert.deepEqual(parseResourcesCommand('{"command":["tool","--json"]}'), ['tool', '--json'])
  for (const bad of ['', '{}', '{"command":[]}', '{"command":"tool"}', '{"command":["tool",1]}', '{"command":[""]}']) assert.equal(parseResourcesCommand(bad), null)
})
