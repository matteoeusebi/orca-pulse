import { assert, test } from 'orca/testing'
import { applyActivity, matchesWork } from '../src/activity'
import { parsePlan } from '../src/model'
import { readProject } from '../src/plans'
import { fixture, plan } from './helpers'

test('work accepts one exact branch or a nonempty prefix with a final wildcard', () => {
  for (const branch of ['main', 'release/*', 'feature/new']) {
    const p = parsePlan(plan([{ id: 'step', title: 'Step', work: { branch } }]))
    assert.equal(p?.phases[0].steps[0].work?.branch, branch)
  }
  for (const branch of ['', '*', 'a*b', 'a**', ' main', 'a\nb']) {
    assert.equal(parsePlan(plan([{ id: 'step', title: 'Step', work: { branch } }])), null)
  }
  assert.equal(matchesWork({ id: 's', title: 'S', work: { branch: 'release/*' } }, 'release/v2'), true)
  assert.equal(matchesWork({ id: 's', title: 'S', work: { branch: 'release/*' } }, 'release'), false)
  assert.equal(matchesWork({ id: 's', title: 'S', work: { branch: 'main' } }, 'main-other'), false)
  assert.equal(matchesWork({ id: 's', title: 'S' }, 'main'), false)
})

test('matching agents never complete unverifiable steps or animate done/dropped plans', async () => {
  const f = await fixture()
  try {
    await f.write('plans/sample.plan.json', plan([
      { id: 'unknown', title: 'Unverifiable', work: { branch: 'main' } },
      { id: 'done', title: 'Done', doneWhen: { manual: true }, work: { branch: 'main' } }
    ]))
    for (const state of ['working', 'waiting', 'blocked']) {
      const result = await readProject(f.root)
      const updated = applyActivity(result.plans, [{ root: f.root, branch: 'main', state }])
      const p = updated[0]; assert.ok(p.kind === 'plan')
      assert.equal(p.done, 1); assert.equal(p.percent, 50)
      assert.equal(p.phases[0].steps[0].state, 'unknown')
      assert.equal(p.phases[0].steps[0].working, state === 'working')
      assert.equal(p.phases[0].steps[0].waiting, state !== 'working')
      assert.equal(p.phases[0].steps[1].working, undefined)
      assert.equal(p.phases[0].steps[1].waiting, false)
    }
    for (const status of ['done', 'dropped'] as const) {
      const result = await readProject(f.root)
      const p = result.plans[0]; assert.ok(p.kind === 'plan'); p.status = status
      const updated = applyActivity(result.plans, [{ root: f.root, branch: 'main', state: 'working' }])[0]
      assert.ok(updated.kind === 'plan')
      assert.equal(updated.working, undefined)
      assert.equal(updated.phases[0].steps[0].working, undefined)
    }
  } finally { await f.close() }
})

test('project work without any step still has a header indicator; a completed plan does not', async () => {
  const f = await fixture()
  try {
    for (const steps of [[], [{ id: 'done', title: 'Done', doneWhen: { manual: true } }]]) {
      await f.write('plans/sample.plan.json', plan(steps))
      const result = await readProject(f.root)
      const updated = applyActivity(result.plans, [{ root: f.root, branch: 'main', state: 'working' }])
      const p = updated[0]; assert.ok(p.kind === 'plan')
      assert.equal(!!p.working, steps.length === 0)
    }
  } finally { await f.close() }
})

test('the step of the focused worker branch is marked, in its own project only and never when done', async () => {
  const f = await fixture()
  try {
    await f.write('plans/sample.plan.json', plan([
      { id: 'one', title: 'Fatto', doneWhen: { manual: true }, work: { branch: 'topic/a' } },
      { id: 'two', title: 'Qui', doneWhen: { manual: false }, work: { branch: 'topic/*' } },
      { id: 'three', title: 'Altro', doneWhen: { manual: false }, work: { branch: 'other' } }
    ]))
    const result = await readProject(f.root)
    const steps = (plans: any[]) => plans[0].phases[0].steps.map((step: any) => !!step.focused)
    assert.deepEqual(steps(applyActivity(result.plans, [], { root: f.root, branch: 'topic/a' })), [false, true, false])
    assert.deepEqual(steps(applyActivity(result.plans, [], { root: '/elsewhere', branch: 'topic/a' })), [false, false, false])
    assert.deepEqual(steps(applyActivity(result.plans, [], { root: f.root, branch: 'main' })), [false, false, false])
    assert.deepEqual(steps(applyActivity(result.plans, [])), [false, false, false])
    await f.write('plans/sample.plan.json', plan([
      { id: 'one', title: 'Primo', doneWhen: { manual: false }, work: { branch: 'topic/a' } },
      { id: 'two', title: 'Secondo', doneWhen: { manual: false }, work: { branch: 'topic/*' } }
    ]))
    const shared = await readProject(f.root)
    assert.deepEqual(steps(applyActivity(shared.plans, [], { root: f.root, branch: 'topic/a' })), [true, false])
  } finally { await f.close() }
})
