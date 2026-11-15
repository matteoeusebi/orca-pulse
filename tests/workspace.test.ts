import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { projectRoot, selectWorkspace, TerminalWorkspaces } from '../src/workspace'
import { FocusedWorkspace } from '../src/focus'
import { area, fixture } from './helpers'

test('worktree resolves to main checkout; ordinary folders stay their own root', async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.root, 'main/.git/worktrees/topic'), { recursive: true })
    await f.write('topic/.git', 'gitdir: ../main/.git/worktrees/topic\n')
    assert.equal(await projectRoot(join(f.root, 'topic')), join(f.root, 'main'))
    assert.equal(await projectRoot(join(f.root, 'main')), join(f.root, 'main'))
    assert.equal(await projectRoot(f.root), f.root)
    await f.write('bad/.git', 'gitdir: /not/a/worktree')
    assert.equal(await projectRoot(join(f.root, 'bad')), null)
  } finally { await f.close() }
})

test('terminal evidence resolves ambiguous focus, conflicting initial evidence does not, and removal clears evidence', () => {
  const a = area('/project/a')
  const b = area('/project/b', 'area-b')
  const list = { workspaces: [a, b], truncated: false }
  const context = { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }, { id: 'other' }] }
  const map = new TerminalWorkspaces()
  const event = (terminalId: string, workspaceId: string | null) => ({ terminalId, workspaceId, paneKey: terminalId, state: 'working', receivedAt: 0 })
  const resolve = () => new FocusedWorkspace().resolve(context, list, map)
  assert.equal(resolve(), null)
  map.record(event('focus', 'uuid::/project/a'))
  assert.equal(resolve()?.id, a.id)
  map.record(event('other', 'area-b'))
  assert.equal(resolve(), null)
  map.record(event('other', null))
  assert.equal(resolve()?.id, a.id)
  assert.equal(new FocusedWorkspace().resolve(context, { ...list, truncated: true }, map), null)
  map.removeWorkspace({ workspaceId: 'area-a', path: '/project/a' })
  assert.equal(resolve(), null)
  assert.equal(selectWorkspace(context, { workspaces: [a], truncated: false })?.id, 'area-a')
})

test('folder workspace without a Git branch matches the empty focused-context branch', () => {
  const folder = { ...area('/project/folder'), branch: null }
  const context = { displayName: 'main', branch: '', terminals: [] }
  assert.equal(selectWorkspace(context, { workspaces: [folder], truncated: false })?.id, folder.id)
})

test('focused project display name resolves a main workspace before any terminal status event', () => {
  const director = { ...area('/project/director', 'director'), project: 'Director' }
  const gateway = { ...area('/project/gateway', 'gateway'), project: 'Gateway' }
  const list = { workspaces: [director, gateway], truncated: false }
  const context = { displayName: 'Director', branch: 'main', terminals: [] }
  assert.equal(selectWorkspace(context, list)?.id, director.id)
  assert.equal(selectWorkspace(context, { ...list, workspaces: [director, { ...gateway, project: 'Director' }] }), null)
})

test('a member terminal can replace a renamed-context name fallback', () => {
  const a = area('/project/a', 'a')
  const b = area('/project/b', 'b')
  const map = new TerminalWorkspaces()
  const context = { displayName: 'Renamed', branch: 'main', terminals: [{ id: 'focus' }] }
  const focus = new FocusedWorkspace()
  const list = { workspaces: [a, { ...b, name: 'Renamed' }], truncated: false }
  assert.equal(focus.resolve(context, list, map)?.id, b.id)
  map.record({ paneKey: 'focus', terminalId: 'focus', workspaceId: a.id })
  assert.equal(focus.resolve(context, list, map)?.id, a.id)
})

test('conflicting initial membership does not guess from a name; canonical and legacy identities agree', () => {
  const a = area('/project/a', 'a', 'Named')
  const b = area('/project/b', 'b')
  const map = new TerminalWorkspaces()
  const context = { displayName: 'Named', branch: 'main', terminals: [{ id: 'one' }, { id: 'two' }] }
  const list = { workspaces: [a, b], truncated: false }
  map.record({ paneKey: 'one', terminalId: 'one', workspaceId: a.id })
  map.record({ paneKey: 'two', terminalId: 'two', workspaceId: b.id })
  assert.equal(new FocusedWorkspace().resolve(context, list, map), null)
  map.record({ paneKey: 'two', terminalId: 'two', workspaceId: `legacy::${a.path}` })
  assert.equal(new FocusedWorkspace().resolve(context, list, map)?.id, a.id)
})


test('membership survives a sibling pane clearing its own association', () => {
  const a = area('/a', 'a')
  const b = area('/b', 'b')
  const map = new TerminalWorkspaces()
  const context = { displayName: 'main', branch: 'main', terminals: [{ id: 'shared' }] }
  const list = { workspaces: [a, b], truncated: false }
  map.record({ paneKey: 'left', terminalId: 'shared', workspaceId: a.id, state: 'working' })
  map.record({ paneKey: 'right', terminalId: 'shared', workspaceId: a.id, state: 'waiting' })
  map.record({ paneKey: 'right', terminalId: 'shared', workspaceId: null })
  const member = map.workspaceFor(context.terminals, list.workspaces)
  assert.ok(member)
  assert.equal(member.id, a.id)
  map.record({ paneKey: 'right', terminalId: 'shared', workspaceId: b.id })
  assert.equal(map.workspaceFor(context.terminals, list.workspaces), false)
})
