import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import en from '../locales/en.json' with { type: 'json' }
import it from '../locales/it.json' with { type: 'json' }
import { translator } from '../src/i18n'
import { PanelState } from '../src/panel-state'
import { renderPanel } from '../src/panel-render'
import { example } from './panel-fixture'

const patterns = Object.entries(en).filter(([, value]) => /[a-z]/i.test(value.replace(/\{\{\w+\}\}/g, ''))).map(([key, value]) => ({
  key,
  pattern: new RegExp(value.split(/(\{\{\w+\}\})/g).map(part =>
    /^\{\{\w+\}\}$/.test(part) ? '[\\s\\S]+?' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join(''))
}))
const leaks = (html: string) => patterns.filter(({ pattern }) => pattern.test(html)).map(({ key }) => key)

test('catalogs have identical keys, placeholders, newlines and punctuation; no bullet separators or straight Italian apostrophes', () => {
  assert.deepEqual(Object.keys(it).sort(), Object.keys(en).sort())
  for (const key of Object.keys(en) as (keyof typeof en)[]) {
    assert.deepEqual(it[key].match(/\{\{\w+\}\}/g)?.sort(), en[key].match(/\{\{\w+\}\}/g)?.sort(), key)
    assert.equal(it[key].split('\n').length, en[key].split('\n').length, key)
    assert.equal(it[key].match(/[.!?:…]+$/)?.[0], en[key].match(/[.!?:…]+$/)?.[0], key)
    assert.ok(!it[key].includes("'"), key)
    assert.doesNotMatch(en[key] + it[key], /[·•]/)
  }
})

test('Italian regional locale works; missing translations fall back to English', () => {
  const original = it['phase.stepsDone']
  delete (it as Partial<typeof it>)['phase.stepsDone']
  try { assert.equal(translator('it-IT')('phase.stepsDone', { done: 2, total: 5 }), '2 of 5 steps') }
  finally { it['phase.stepsDone'] = original }
  assert.equal(translator('it-IT')('app.allPlans'), 'Tutti i piani')
  assert.equal(translator('de')('app.allPlans'), 'All plans')
})

test('catalog-wide detector catches copied English including aria labels and templates', () => {
  for (const [key, value] of Object.entries(en)) {
    if (!/[a-z]/i.test(value.replace(/\{\{\w+\}\}/g, ''))) continue
    assert.ok(leaks(`<span aria-label="${value.replace(/\{\{\w+\}\}/g, 'ESEMPIO')}"></span>`).includes(key), key)
  }
  const original = it['app.loading']; it['app.loading'] = en['app.loading']
  try { assert.ok(leaks(renderPanel(new PanelState(), 'it')).includes('app.loading')) }
  finally { it['app.loading'] = original }
})

test('HTML in Italian contains no English catalog text across loading, errors, stale, future and plan states', async () => {
  const { f, data } = await example()
  try {
    const state = new PanelState()
    assert.deepEqual(leaks(renderPanel(state, 'it')), [])
    state.failed = true
    assert.deepEqual(leaks(renderPanel(state, 'it')), [])
    const reasons = ['invalidJson', 'invalidPlan', 'permission', 'missing', 'unsafePath', 'read', 'remote'] as const
    for (const reason of reasons) {
      state.accept({ ...data, lastSuccessAt: 0, errors: [{ file: 'rotto.plan.json', reason }] })
      assert.deepEqual(leaks(renderPanel(state, 'it-IT')), [])
    }
    state.accept({ ...data, plans: [{ kind: 'future', root: data.activeRoot!, file: 'plans/future.plan.json', title: 'Domani' }] })
    assert.match(renderPanel(state, 'it'), /Aggiorna il plugin per leggere questo piano/)
    assert.deepEqual(leaks(renderPanel(state, 'it')), [])
  } finally { await f.close() }
})

test('unused app.title is absent from both catalogs', () => {
  assert.equal(Object.hasOwn(en, 'app.title'), false)
  assert.equal(Object.hasOwn(it, 'app.title'), false)
})
