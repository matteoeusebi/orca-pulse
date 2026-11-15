import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import { applyActivity } from '../src/activity'
import { readProject } from '../src/plans'
import { fixture, plan } from './helpers'

function freeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) freeze(item)
    Object.freeze(value)
  }
  return value
}

test('activity returns new views without mutating frozen plan facts or leaking state between evaluations', async () => {
  const f = await fixture()
  try {
    await f.write('plans/sample.plan.json', plan([{ id: 'build', title: 'Build', work: { branch: 'main' } }]))
    const original = freeze((await readProject(f.root)).plans)
    const before = structuredClone(original)
    const updated = applyActivity(original, [{ root: f.root, branch: 'main', state: 'waiting' }])
    assert.deepEqual(original, before)
    assert.notEqual(updated, original)
    assert.ok(updated[0].kind === 'plan' && original[0].kind === 'plan')
    assert.notEqual(updated[0], original[0])
    assert.notEqual(updated[0].phases[0], original[0].phases[0])
    assert.notEqual(updated[0].phases[0].steps[0], original[0].phases[0].steps[0])
    assert.equal(updated[0].phases[0].steps[0].waiting, true)
    const next = applyActivity(original, [])
    assert.ok(next[0].kind === 'plan')
    assert.equal(next[0].phases[0].steps[0].waiting, false)
    assert.equal(next[0].phases[0].state, 'notStarted')
  } finally { await f.close() }
})
