import { assert, test } from 'orca/testing'
import { readProject } from '../src/plans'
import { fixture, plan } from './helpers'

test('malformed or conflicting completion rules stay unknown, empty phases stay at zero', async () => {
  const f = await fixture()
  try {
    const values = [null, true, 'future', {}, { manual: 'true' }, { approval: '2026-02-30' }, { manual: true, file: 'proof.md' }]
    const p = plan(values.map((doneWhen, i) => ({ id: `s-${i}`, title: 'Prova', doneWhen })))
    p.phases.push({ id: 'empty', title: 'Vuota', steps: [] })
    await f.write('proof.md')
    await f.write('plans/sample.plan.json', p)
    const result = (await readProject(f.root)).plans[0]
    assert.ok(result.kind === 'plan')
    assert.equal(result.done, 0)
    assert.equal(result.percent, 0)
    assert.equal(result.phases[1].state, 'notStarted')
    assert.ok(result.phases[0].steps.every((s) => s.state === 'unknown'))
  } finally { await f.close() }
})

test('bad v1 structure is isolated, including duplicate identifiers and invalid approval date', async () => {
  const f = await fixture()
  try {
    const duplicate = plan([{ id: 'same', title: 'A' }, { id: 'same', title: 'B' }])
    await f.write('plans/duplicate.plan.json', duplicate)
    await f.write('plans/date.plan.json', { ...plan(), approvedOn: '2026-02-30' })
    await f.write('plans/id.plan.json', { ...plan(), id: 'Bad Identifier' })
    await f.write('plans/empty.plan.json', { ...plan(), phases: [] })
    const result = await readProject(f.root)
    assert.equal(result.errors.length, 3)
    assert.ok(result.errors.every((error) => error.reason === 'invalidPlan'))
    assert.equal(result.plans.length, 1)
  } finally { await f.close() }
})
