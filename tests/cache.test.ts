import { chmod, rm, symlink, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { PlanFileCache } from '../src/plan-cache'
import { readText } from '../src/files'
import { readProject } from '../src/plans'
import { fixture, plan } from './helpers'

test('unchanged plan files reuse parsed contents; mtime changes reread them', async () => {
  const f = await fixture()
  let reads = 0
  const cache = new PlanFileCache(async (root, file) => { reads++; return readText(root, file) })
  try {
    await f.write('plans/sample.plan.json', plan())
    const first = await cache.load(f.root, 'plans/sample.plan.json')
    assert.equal(await cache.load(f.root, 'plans/sample.plan.json'), first)
    assert.equal(reads, 1)
    await f.write('plans/sample.plan.json', { ...plan(), title: 'Aggiornato' })
    await utimes(join(f.root, 'plans/sample.plan.json'), 1000, 1000)
    assert.equal((await cache.load(f.root, 'plans/sample.plan.json') as {title:string}).title, 'Aggiornato')
    assert.equal(reads, 2)
  } finally { await f.close() }
})

test('cached plan parsing still sees new evidence, removals, permission changes and symlinks', async () => {
  const f = await fixture()
  let reads = 0
  const cache = new PlanFileCache(async (root, file) => { reads++; return readText(root, file) })
  try {
    await f.write('plans/sample.plan.json', plan([{ id:'proof', title:'Prova', doneWhen:{file:'proof.md'} }]))
    const first = (await readProject(f.root, cache)).plans[0]
    assert.ok(first.kind === 'plan')
    assert.equal(first.done, 0)
    await f.write('proof.md')
    const next = (await readProject(f.root, cache)).plans[0]
    assert.ok(next.kind === 'plan')
    assert.equal(next.done, 1)
    assert.equal(reads, 1)
    await chmod(join(f.root, 'plans/sample.plan.json'), 0)
    assert.equal((await readProject(f.root, cache)).errors[0]?.reason, 'permission')
    await chmod(join(f.root, 'plans/sample.plan.json'), 0o600)
    await rm(join(f.root, 'plans/sample.plan.json'))
    await f.write('elsewhere.json', plan())
    await symlink('../elsewhere.json', join(f.root, 'plans/sample.plan.json'))
    assert.equal((await readProject(f.root, cache)).errors[0]?.reason, 'unsafePath')
    await rm(join(f.root, 'plans/sample.plan.json'))
    assert.equal((await readProject(f.root, cache)).plans.length, 0)
  } finally { await f.close() }
})
