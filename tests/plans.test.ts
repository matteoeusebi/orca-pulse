import { chmod, mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { readProject } from '../src/plans'
import { fixture, plan } from './helpers'

test('manual, file and dated approval close only satisfied steps; unknown rules never close', async () => {
  const f = await fixture()
  try {
    await f.write('proof.md')
    await f.write('plans/sample.plan.json', plan([
      { id: 'manual', title: 'Uno', doneWhen: { manual: true } },
      { id: 'open', title: 'Due', doneWhen: { manual: false } },
      { id: 'file', title: 'Tre', doneWhen: { file: 'proof.md' } },
      { id: 'missing', title: 'Quattro', doneWhen: { file: 'missing.md' } },
      { id: 'approval', title: 'Cinque', doneWhen: { approval: '2026-11-12' } },
      { id: 'waiting', title: 'Sei', doneWhen: { approval: '' } },
      { id: 'unknown', title: 'Sette', doneWhen: { gitTag: 'v1' } }
    ]))
    const data = await readProject(f.root)
    assert.equal(data.plans.length, 1)
    const p = data.plans[0]
    assert.ok(p.kind === 'plan')
    assert.deepEqual(p.phases[0].steps.map((s: any) => s.state), ['done', 'open', 'done', 'open', 'done', 'open', 'unknown'])
    assert.equal(p.done, 3)
    assert.equal(p.total, 7)
    assert.equal(p.percent, 42)
    assert.equal(p.phases[0].state, 'waiting')
  } finally { await f.close() }
})

test('phase sizes weight progress; unsized phases count each step equally', async () => {
  const f = await fixture()
  try {
    const p = plan()
    p.phases.push({ id: 'later', title: 'Dopo', steps: [
      { id: 'a', title: 'A', doneWhen: { manual: false } },
      { id: 'b', title: 'B', doneWhen: { manual: false } }
    ] })
    await f.write('plans/sample.plan.json', p)
    const unsized = (await readProject(f.root)).plans[0]
    assert.ok(unsized.kind === 'plan')
    assert.equal(unsized.percent, 33)
    Object.assign(p.phases[0], { size: 'l' })
    Object.assign(p.phases[1], { size: 's' })
    await f.write('plans/sample.plan.json', p)
    const result = (await readProject(f.root)).plans[0]
    assert.ok(result.kind === 'plan')
    assert.equal(result.percent, 88)
    assert.equal(result.done, 1)
    assert.equal(result.total, 3)
  } finally { await f.close() }
})

test('missing plans is empty; broken files isolate errors; future schema survives without v1 fields', async () => {
  const f = await fixture()
  try {
    assert.deepEqual(await readProject(f.root), { plans: [], errors: [] })
    await f.write('plans/sample.plan.json', { ...plan(), futureField: true })
    await f.write('plans/broken.plan.json', '{')
    await f.write('plans/future.plan.json', { schemaVersion: 9, title: 'Domani' })
    await f.write('plans/ignored.json', '{')
    const result = await readProject(f.root)
    assert.equal(result.plans.length, 2)
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0].reason, 'invalidJson')
    assert.equal(result.plans.find((p: any) => p.kind === 'future')?.title, 'Domani')
  } finally { await f.close() }
})

test('unreadable project gives one error instead of pretending it has no plan', async () => {
  const f = await fixture()
  try {
    await mkdir(join(f.root, 'private'))
    await chmod(join(f.root, 'private'), 0)
    const result = await readProject(join(f.root, 'private'))
    assert.equal(result.errors.length, 1)
    assert.equal(result.errors[0].reason, 'permission')
  } finally { await chmod(join(f.root, 'private'), 0o700); await f.close() }
})

test('file evidence rejects traversal, absolute paths, symlinks, directories and Director core', async () => {
  const f = await fixture()
  try {
    await f.write('outside/proof.md')
    await f.write('project/proof.md')
    await symlink(join(f.root, 'outside'), join(f.root, 'project/link'))
    await symlink('proof.md', join(f.root, 'project/alias'))
    await f.write('project/.grok/skills/director/state/proof.md')
    const paths = ['../outside/proof.md', join(f.root, 'outside/proof.md'), 'link/proof.md', 'alias', '.', '.grok/skills/director/state/proof.md', '..\\outside\\proof.md']
    await f.write('project/plans/sample.plan.json', plan(paths.map((file, i) => ({ id: `s-${i}`, title: file, doneWhen: { file } }))))
    const p = (await readProject(join(f.root, 'project'))).plans[0]
    assert.ok(p.kind === 'plan')
    assert.equal(p.done, 0)
    assert.ok(p.phases[0].steps.every((s: any) => s.state === 'unknown'))
  } finally { await f.close() }
})

test('symlink plan directories and files cannot import outside content', async () => {
  const f = await fixture()
  try {
    await f.write('outside/sample.plan.json', plan())
    await mkdir(join(f.root, 'project'))
    await symlink(join(f.root, 'outside'), join(f.root, 'project/plans'))
    assert.equal((await readProject(join(f.root, 'project'))).plans.length, 0)
    await mkdir(join(f.root, 'other/plans'), { recursive: true })
    await symlink(join(f.root, 'outside/sample.plan.json'), join(f.root, 'other/plans/sample.plan.json'))
    assert.equal((await readProject(join(f.root, 'other'))).plans.length, 0)
  } finally { await f.close() }
})

test('percentages floor incomplete progress and reach 100 only when all steps are done', async () => {
  const f = await fixture()
  try {
    const steps = Array.from({ length: 200 }, (_, i) => ({ id: `s-${i}`, title: 'Prova', doneWhen: { manual: i < 199 } }))
    await f.write('plans/sample.plan.json', plan(steps))
    let p = (await readProject(f.root)).plans[0]
    assert.ok(p.kind === 'plan')
    assert.equal(p.percent, 99)
    assert.equal(p.phases[0].percent, 99)
    steps[199].doneWhen.manual = true
    await f.write('plans/sample.plan.json', plan(steps))
    p = (await readProject(f.root)).plans[0]
    assert.ok(p.kind === 'plan')
    assert.equal(p.percent, 100)
    for (let i = 1; i < 200; i++) steps[i].doneWhen.manual = false
    await f.write('plans/sample.plan.json', plan(steps))
    p = (await readProject(f.root)).plans[0]
    assert.ok(p.kind === 'plan')
    assert.equal(p.percent, 0)
    assert.equal(p.phases[0].percent, 0)
  } finally { await f.close() }
})

test('mixed sized plans give every unsized phase medium weight; wholly unsized plans count steps', async () => {
  const f = await fixture()
  try {
    const p = plan()
    p.phases.push({ id: 'later', title: 'Dopo', steps: Array.from({ length: 4 }, (_, i) => ({ id: `s-${i}`, title: 'Prova', doneWhen: { manual: false } })) })
    await f.write('plans/sample.plan.json', p)
    let view = (await readProject(f.root)).plans[0]
    assert.ok(view.kind === 'plan')
    assert.equal(view.percent, 20)
    Object.assign(p.phases[0], { size: 's' })
    await f.write('plans/sample.plan.json', p)
    view = (await readProject(f.root)).plans[0]
    assert.ok(view.kind === 'plan')
    assert.equal(view.percent, 25)
    assert.equal(view.done, 1)
    assert.equal(view.total, 5)
  } finally { await f.close() }
})

test('flooring preserves exact integer percentages instead of floating-point undercounting', async () => {
  const f = await fixture()
  try {
    await f.write('plans/sample.plan.json', plan(Array.from({length:100}, (_, i) => ({id:`s-${i}`,title:'Prova',doneWhen:{manual:i<29}}))))
    const p = (await readProject(f.root)).plans[0]
    assert.ok(p.kind === 'plan')
    assert.equal(p.phases[0].percent, 29)
    assert.equal(p.percent, 29)
  } finally { await f.close() }
})
