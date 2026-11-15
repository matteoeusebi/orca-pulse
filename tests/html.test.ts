import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import type { Snapshot } from '../src/model'
import { PanelState } from '../src/panel-state'
import { renderPanel } from '../src/panel-render'
import { planKey } from '../src/panel-state'
import { example, foreign } from './panel-fixture'

const text = (html: string) => html.replace(/<[^>]*>/g, '')

test('HTML header, phase defaults, real waiting marks and verification labels follow the approved design', async () => {
  const { f, data } = await example()
  try {
    const state = new PanelState(); state.accept(data)
    const html = renderPanel(state, 'en')
    assert.match(html, /<header[^>]*>.*Alba.*1\/3.*33%.*<\/header>/s)
    assert.match(html, /class="row phase[^\"]*"[^>]*aria-expanded="true"/)
    assert.match(html, /class="row step waiting"/)
    assert.match(html, /To verify/)
    assert.match(html, /Other plans/)
    assert.doesNotMatch(html, /class="caption">Waiting on you|<small[^>]*>Waiting on you|Last read|Refresh|·|•|Tree|esempio/)
    assert.equal((html.match(/class="waiting-mark"/g) ?? []).length, 1)
    assert.match(html, /type="button"/)
    assert.match(html, /aria-controls=/)
  } finally { await f.close() }
})

test('other-plan selection and toggles last only until the workspace changes; completion closes a phase', async () => {
  const { f, data } = await example()
  try {
    const state = new PanelState(); state.accept(data)
    const plan = data.plans.find(p => p.title === 'Alba')!
    assert.ok(plan.kind === 'plan')
    state.togglePhase(plan, plan.phases[0])
    assert.equal(state.phaseOpen(plan, plan.phases[0]), false)
    state.accept({ ...data })
    assert.equal(state.phaseOpen(plan, plan.phases[0]), false)
    const other = data.plans.find(p => p.title === 'Zenit')!
    state.selectPlan(planKey(other))
    assert.equal(state.currentPlan?.title, 'Zenit')
    state.accept({ ...data, workspaceKey: 'new', activeRoot: '/another' })
    assert.equal(state.selected, null)
    state.accept(data)
    assert.equal(state.phaseOpen(plan, plan.phases[0]), true)
    const next = structuredClone(data)
    const completed = next.plans.find(p => p.title === 'Alba')!
    assert.ok(completed.kind === 'plan')
    Object.assign(completed.phases[0], { done: 3, state: 'done', percent: 100 })
    completed.phases[0].steps.forEach(step => { step.state = 'done'; step.waiting = false })
    state.accept(next)
    assert.equal(state.phaseOpen(completed, completed.phases[0]), false)
    state.accept(data)
    assert.equal(state.phaseOpen(plan, plan.phases[0]), true)
    state.accept(next)
    state.togglePhase(completed, completed.phases[0])
    assert.equal(state.phaseOpen(completed, completed.phases[0]), true)
  } finally { await f.close() }
})

test('a focused project shows only its own plans: plans of other projects are hidden', async () => {
  const { f, data } = await example()
  try {
    const moved = foreign(data)
    const state = new PanelState(); state.accept(moved)
    for (const [locale, caption] of [['en', 'Other plans'], ['it', 'Altri piani']]) {
      const html = renderPanel(state, locale)
      assert.match(html, /Alba/)
      assert.doesNotMatch(html, /Zenit/)
      assert.ok(!html.includes(caption))
    }
    const empty = new PanelState(); empty.accept({ ...moved, plans: moved.plans.filter(p => p.title === 'Zenit') })
    const html = renderPanel(empty, 'it')
    assert.ok(text(html).includes('Nessun piano per Alba'))
    assert.doesNotMatch(html, /Zenit|Tutti i piani|data-plan=/)
  } finally { await f.close() }
})

test('resources come from the provider as one quiet line; absent data leaves no trace', async () => {
  const { f, data } = await example()
  try {
    const state = new PanelState(); state.accept(data)
    assert.doesNotMatch(renderPanel(state, 'it'), /class="resources/)
    const cases = [['green', 'Computer libero', 'Computer free'], ['yellow', 'Computer carico', 'Computer busy'], ['red', 'Computer al limite', 'Computer at its limit']] as const
    for (const [light, it, en] of cases) {
      state.accept({ ...data, resources: { light, used: 3, max: 4 } })
      const italian = renderPanel(state, 'it'), english = renderPanel(state, 'en')
      assert.match(italian, new RegExp(`<footer class="resources ${light}">`))
      assert.ok(text(italian).includes(it) && text(italian).includes('Worker 3 su 4'))
      assert.ok(text(english).includes(en) && text(english).includes('Workers 3 of 4'))
      assert.doesNotMatch(italian, /·|•/)
    }
    state.accept({ ...data, plans: [], resources: { light: 'green', used: 0, max: 4 } })
    assert.match(renderPanel(state, 'it'), /class="resources green"/)
  } finally { await f.close() }
})

test('the focused worker step is shown as current and its phase opens', async () => {
  const { f, data } = await example()
  try {
    const next = structuredClone(data)
    const alba = next.plans.find(p => p.title === 'Alba')!
    assert.ok(alba.kind === 'plan')
    alba.phases[0].steps[2].focused = true
    const state = new PanelState(); state.accept(next)
    const html = renderPanel(state, 'it')
    assert.match(html, /class="row step current here">.*?Terzo/s)
    assert.equal((html.match(/class="row step current here"/g) ?? []).length, 1)
  } finally { await f.close() }
})

test('no-project view lists real plans with next steps; completed plans stay one muted row', async () => {
  const { f, data } = await example()
  try {
    const state = new PanelState(); state.accept({ ...data, activeRoot: null, workspaceKey: null })
    const html = renderPanel(state, 'en')
    assert.match(html, /All plans/)
    assert.match(html, /class="next-step"/)
    assert.match(html, /Secondo/)
    assert.equal((html.match(/data-plan=/g) ?? []).length, 1)
    assert.doesNotMatch(html, /data-phase=/)
    const other = data.plans.find(p => p.title === 'Zenit')!
    state.selectPlan(planKey(other))
    assert.match(renderPanel(state, 'en'), /class="row plan done"/)
    assert.doesNotMatch(renderPanel(state, 'en'), /data-phase=/)
  } finally { await f.close() }
})

test('all edge states and localized error limits survive HTML rendering', async () => {
  const { f, data } = await example()
  try {
    const plan = data.plans.find(p => p.kind === 'plan')!
    const cases: [Snapshot, string, string][] = [
      [{ ...data, plans: [] }, 'No plan for Alba', 'Nessun piano per Alba'],
      [{ ...data, plans: [], activeRoot: null }, 'No plans available', 'Nessun piano disponibile'],
      [{ ...data, truncated: true }, 'Workspace list is incomplete', 'L’elenco delle aree di lavoro è incompleto'],
      [{ ...data, lastSuccessAt: 0 }, 'Out of date', 'Dati non aggiornati'],
      [{ ...data, plans: [{ ...plan, root: data.activeRoot!, done: 0, total: 0, phases: [] }] }, 'No phases yet', 'Ancora nessuna fase'],
      [{ ...data, plans: [{ ...plan, root: data.activeRoot!, done: 0, total: 0, phases: [{ ...plan.phases[0], steps: [], total: 0, done: 0, state: 'notStarted' as const }] }] }, 'No steps yet', 'Ancora nessun passo'],
      [{ ...data, plans: [{ kind: 'future' as const, root: data.activeRoot!, file: 'plans/future.plan.json', title: 'Domani' }] }, 'Update the plugin to read this plan', 'Aggiorna il plugin per leggere questo piano']
    ]
    for (const [snapshot, en, it] of cases) for (const [locale, expected] of [['en', en], ['it', it]]) {
      const state = new PanelState(); state.accept(snapshot)
      assert.ok(text(renderPanel(state, locale)).includes(expected), expected)
    }
    for (const locale of ['en', 'it']) for (const count of [0, 3, 4, 5]) {
      const state = new PanelState(); state.accept({ ...data, errors: Array.from({ length: count }, () => ({ file: '/projects/folder/plans/broken.plan.json', reason: 'invalidJson' })) })
      const html = renderPanel(state, locale)
      assert.equal((html.match(/class="message error"/g) ?? []).length, Math.min(3, count))
      assert.doesNotMatch(html, /\/projects/)
      if (count) assert.match(html, /folder\/broken.plan.json/)
      if (count > 3) assert.ok(text(html).includes(locale === 'it' ? `e ${count - 3} in più` : `and ${count - 3} more`))
    }
    const empty = new PanelState()
    assert.match(renderPanel(empty, 'it'), /Caricamento…/)
    empty.failed = true
    assert.match(renderPanel(empty, 'it'), /Impossibile aggiornare i piani/)
    assert.doesNotMatch(renderPanel(empty, 'it'), /Caricamento…/)
  } finally { await f.close() }
})

test('plan text and attributes are escaped; counts remain singular/plural for assistive technology', async () => {
  const { f, data } = await example()
  try {
    const plan = data.plans.find(p => p.title === 'Alba')!
    assert.ok(plan.kind === 'plan')
    plan.title = '<img src=x onerror="bad()">'
    plan.phases[0].title = '" onclick="bad()'
    const state = new PanelState(); state.accept(data)
    const html = renderPanel(state, 'en')
    assert.doesNotMatch(html, /<img|<[^>]* onclick=/)
    assert.match(html, /&lt;img/)
    for (const [done, total, count] of [[0, 0, '0 of 0 steps'], [0, 1, '0 of 1 step'], [1, 1, '1 of 1 step'], [1, 2, '1 of 2 steps']] as const) {
      Object.assign(plan, { done, total }); state.accept(data)
      assert.ok(renderPanel(state, 'en').includes(count))
    }
  } finally { await f.close() }
})

test('manifest chooses HTML; styling uses theme variables, compact typography and reduced motion', async () => {
  const manifest = JSON.parse(await readFile(new URL('../orca-plugin.json', import.meta.url), 'utf8'))
  assert.equal(manifest.contributes.panels[0].ui, 'html')
  const css = await readFile(new URL('../src/panel-style.ts', import.meta.url), 'utf8')
  for (const expected of ['--orca-background', '--orca-foreground', '--orca-muted-foreground', '--orca-border', '--orca-accent', 'prefers-reduced-motion', ':focus-visible', '26px', '12px', '11px', '13px', '"Geist"', 'html.dark']) assert.ok(css.includes(expected), expected)
  assert.equal((css.match(/#[0-9a-f]{6}/gi) ?? []).length, 4)
})

test('declared done or dropped never invents factual completion or owner-waiting marks', async () => {
  const { f, data } = await example()
  try {
    const plan = data.plans.find(p => p.title === 'Alba')!
    assert.ok(plan.kind === 'plan')
    for (const status of ['done', 'dropped'] as const) {
      plan.status = status
      const state = new PanelState(); state.accept({ ...data, plans: [plan] })
      const html = renderPanel(state, 'en')
      assert.match(html, /Some steps need verification/)
      assert.doesNotMatch(html, /class="row plan done"|class="waiting-mark"|class="spinner"/)
      assert.match(html, /1\/3/)
    }
  } finally { await f.close() }
})
