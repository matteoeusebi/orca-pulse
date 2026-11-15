import { mkdir, readFile, rm, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { assert, test } from 'orca/testing'
import { readProject } from '../src/plans'
import { PlanFileCache } from '../src/plan-cache'
import { fixture, plan } from './helpers'

const oid = 'a'.repeat(40)

test('reftable directory or config makes tag evidence unknown even with stale loose refs', async () => {
  const f = await fixture()
  try {
    await f.write('plans/sample.plan.json', plan([{ id: 'tag', title: 'Tag', doneWhen: { gitTag: 'v1' } }]))
    const read = async () => {
      const p = (await readProject(f.root)).plans[0]; assert.ok(p.kind === 'plan')
      return p.phases[0].steps[0].state
    }
    await mkdir(join(f.root, '.git/reftable'), { recursive: true })
    assert.equal(await read(), 'unknown')
    await rm(join(f.root, '.git/reftable'), { recursive: true })
    for (const config of [
      '[extensions]\nrefStorage = reftable\n',
      '[EXTENSIONS] # backend\n RefStorage = "reftable" ; comment\n',
      '[extensions]\nrefStorage = ref\\\ntable\n',
      '[extensions]\nrefStorage = "ref"table\n'
    ]) {
      await f.write('.git/config', config)
      assert.equal(await read(), 'unknown')
    }
    await f.write('.git/refs/tags/v1', `${oid}\n`)
    assert.equal(await read(), 'unknown')
    await f.write('.git/config', '[core]\nrefStorage = reftable\n[extensions]\nrefStorage = files\n')
    assert.equal(await read(), 'done')
    await rm(join(f.root, '.git/refs/tags/v1'))
    assert.equal(await read(), 'open')
  } finally { await f.close() }
})
test('self-closing fixture reevaluates file and tag without editing the cached plan', async () => {
  const f = await fixture()
  try {
    const source = await readFile(new URL('../fixtures/self-closing/plans/release.plan.json', import.meta.url), 'utf8')
    await f.write('plans/release.plan.json', source)
    await mkdir(join(f.root, '.git'))
    const cache = new PlanFileCache()
    const read = async () => {
      const p = (await readProject(f.root, cache)).plans[0]
      assert.ok(p.kind === 'plan')
      return p
    }
    assert.equal((await read()).done, 0)
    await f.write('docs/report.md')
    assert.equal((await read()).percent, 50)
    await f.write('.git/refs/tags/v1.2.0', `${oid}\n`)
    let p = await read()
    assert.equal(p.done, 2)
    assert.equal(p.percent, 100)
    assert.equal(p.phases[0].state, 'done')
    await rm(join(f.root, '.git/refs/tags/v1.2.0'))
    assert.equal((await read()).percent, 50)
    await f.write('.git/packed-refs', `# pack-refs with: peeled fully-peeled sorted\n${oid} refs/tags/v1.2.0\n^${'b'.repeat(40)}\n`)
    assert.equal((await read()).percent, 100)
    assert.equal(await readFile(join(f.root, 'plans/release.plan.json'), 'utf8'), source)
  } finally { await f.close() }
})

test('tag evidence rejects unsafe refs and non-repositories, handles nested, packed and malformed refs', async () => {
  const f = await fixture()
  try {
    const tags = ['releases/v2', 'packed', 'absent', '../outside', '/tag', 'bad..name', 'bad.lock', 'malformed', 'linked']
    await f.write('plans/sample.plan.json', plan(tags.map((gitTag, i) => ({ id: `s-${i}`, title: gitTag, doneWhen: { gitTag } }))))
    let p = (await readProject(f.root)).plans[0]
    assert.ok(p.kind === 'plan')
    assert.ok(p.phases[0].steps.every(step => step.state === 'unknown'))
    await f.write('.git/refs/tags/releases/v2', `${'c'.repeat(64)}\n`)
    await f.write('.git/refs/tags/malformed', 'not a ref')
    await f.write('.git/packed-refs', `${oid} refs/heads/absent\n${oid} refs/tags/packed-other\n${oid} refs/tags/packed\n`)
    await symlink(join(f.root, '.git/refs/tags/releases/v2'), join(f.root, '.git/refs/tags/linked'))
    p = (await readProject(f.root)).plans[0]
    assert.ok(p.kind === 'plan')
    assert.deepEqual(p.phases[0].steps.map(step => step.state), ['done', 'done', 'open', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown', 'unknown'])
    await rm(join(f.root, '.git'), { recursive: true })
    await mkdir(join(f.root, 'other'))
    await symlink(join(f.root, 'other'), join(f.root, '.git'))
    p = (await readProject(f.root)).plans[0]
    assert.ok(p.kind === 'plan')
    assert.equal(p.done, 0)
    assert.ok(p.phases[0].steps.every(step => step.state === 'unknown'))
  } finally { await f.close() }
})
