import { readProject } from '../src/plans'
import type { Snapshot } from '../src/model'
import { fixture, plan } from './helpers'

export async function example() {
  const f = await fixture()
  await f.write('plans/sample.plan.json', plan([
    { id: 'one', title: 'Primo', doneWhen: { manual: true } },
    { id: 'two', title: 'Secondo', doneWhen: { approval: '' } },
    { id: 'three', title: 'Terzo', doneWhen: { gitTag: 'v1' } }
  ]))
  await f.write('plans/zenit.plan.json', { ...plan(), id: 'other', title: 'Zenit', status: 'proposed' })
  const result = await readProject(f.root)
  const data: Snapshot = { ...result, activeRoot: f.root, activeName: 'Alba', workspaceKey: 'a', readAt: Date.now(), lastSuccessAt: Date.now(), truncated: false }
  return { f, data }
}

/** Same data with the second plan owned by another project root. */
export const foreign = (data: Snapshot): Snapshot => ({ ...data, plans: data.plans.map(p => p.title === 'Zenit' ? { ...p, root: '/another' } : p) })
