import assert from 'node:assert/strict'
import { test } from 'orca/testing'
import type { Snapshot } from '../src/model'
import { example } from './panel-fixture'
import { openPanel } from './page-harness'

const context = { displayName: 'main', branch: 'main', terminals: [{ id: 'focus' }] }

test('actual page selects plans, toggles phases through delegated clicks, preserves focus and redraws on theme events', async () => {
  const { f, data } = await example()
  const other = data.plans.find(plan => plan.title === 'Zenit')!
  assert.ok(other.kind === 'plan')
  Object.assign(other, { done: 0, percent: 0 })
  Object.assign(other.phases[0], { state: 'notStarted', done: 0 })
  other.phases[0].steps[0].state = 'open'
  const view = await openPanel(data)
  try {
    assert.equal(view.document.head.querySelector('style')?.textContent.includes('--orca-background'), true)
    assert.equal(view.root.querySelector('h1')?.textContent, 'Alba')
    const phase = view.root.querySelector('button.phase')!
    assert.equal(phase.getAttribute('aria-expanded'), 'true')
    phase.focus()
    phase.querySelector('.name')!.click()
    const closed = view.root.querySelector('button.phase')!
    assert.equal(closed.getAttribute('aria-expanded'), 'false')
    assert.notEqual(closed, phase)
    assert.equal(view.document.activeElement, closed)
    assert.deepEqual(closed.focusOptions, { preventScroll: true })
    const updated = structuredClone(data)
    const active = updated.plans.find(plan => plan.title === 'Alba')!
    assert.ok(active.kind === 'plan'); active.percent = 34
    view.page.snapshot = updated
    await view.poll()
    assert.equal(view.root.querySelector('.percent')?.textContent, '34%')
    assert.equal(view.document.activeElement, view.root.querySelector('button.phase'))
    assert.equal(view.root.querySelector('button.phase')?.getAttribute('aria-expanded'), 'false')
    const selection = view.root.querySelector('button[data-plan]')!
    assert.equal(selection.getAttribute('aria-expanded'), null)
    selection.focus(); selection.querySelector('.name')!.click()
    assert.equal(view.root.querySelector('h1')?.textContent, 'Zenit')
    assert.equal(view.root.querySelector('[aria-current="true"]')?.textContent, 'Zenit')
    assert.equal(view.document.activeElement, view.root.querySelector('button.phase'))
    const requests = view.page.requests
    view.api.locale = 'it-IT'
    await view.emit('theme', { colorScheme: 'light' })
    assert.equal(view.document.documentElement.lang, 'it-IT')
    assert.match(view.root.textContent, /Altri piani/)
    assert.equal(view.page.requests, requests)
    await view.emit('workspace.changed', { context })
    assert.equal(view.root.querySelector('h1')?.textContent, 'Zenit')
  } finally { view.close(); await f.close() }
  assert.equal(view.handlers.size, 0)
  assert.equal(view.timers.size, 0)
})

test('actual page renders loading and failed initial reads without retaining a spinner', async () => {
  const loading = await openPanel(null, 'it')
  try { assert.match(loading.root.textContent, /Caricamento…/); assert.equal(loading.root.querySelector('.spinner'), null) }
  finally { loading.close() }
  const { f, data } = await example()
  const failed = await openPanel(data, 'en', { failed: true })
  try {
    assert.match(failed.root.textContent, /Couldn’t refresh plans/)
    assert.equal(failed.root.querySelector('.spinner'), null)
    assert.doesNotMatch(failed.root.textContent, /Loading…/)
    failed.page.failed = false
    await failed.poll()
    assert.equal(failed.root.querySelector('h1')?.textContent, 'Alba')
    failed.page.failed = true
    await failed.poll()
    assert.match(failed.root.textContent, /Couldn’t refresh plans/)
    assert.equal(failed.root.querySelector('h1')?.textContent, 'Alba')
    assert.equal(failed.root.querySelector('.spinner'), null)
  } finally { failed.close(); await f.close() }
})

test('actual page renders every data state and localized bounded errors through the frame bridge', async () => {
  const { f, data } = await example()
  const plan = data.plans.find(item => item.title === 'Alba')!
  assert.ok(plan.kind === 'plan')
  const empty = { ...plan, phases: [], done: 0, total: 0, percent: 0, warning: false }
  const cases: [Snapshot, string][] = [
    [{ ...data, truncated: true }, 'Workspace list is incomplete'],
    [{ ...data, plans: [] }, 'No plan for Alba'],
    [{ ...data, plans: [], activeRoot: null }, 'No plans available'],
    [{ ...data, lastSuccessAt: 0 }, 'Out of date'],
    [{ ...data, plans: [{ kind: 'future', root: plan.root, file: 'plans/future.plan.json', title: 'Domani' }] }, 'Update the plugin to read this plan'],
    [data, 'Some steps need verification'],
    [{ ...data, plans: [empty] }, 'No phases yet'],
    [{ ...data, plans: [{ ...empty, phases: [{ ...plan.phases[0], steps: [], done: 0, total: 0, state: 'notStarted' }] }] }, 'No steps yet']
  ]
  try {
    for (const [snapshot, text] of cases) {
      const view = await openPanel(snapshot)
      try { assert.ok(view.root.textContent.includes(text), text) }
      finally { view.close() }
    }
    for (const locale of ['en', 'it']) for (const count of [0, 3, 4, 5]) {
      const view = await openPanel({ ...data, errors: Array.from({ length: count }, () => ({ file: '/project/folder/plans/bad.plan.json', reason: 'invalidJson' })) }, locale)
      try {
        assert.equal(view.root.querySelectorAll('.message.error').length, Math.min(count, 3))
        if (count) assert.match(view.root.textContent, /folder\/bad.plan.json/)
        if (count > 3) assert.ok(view.root.textContent.includes(locale === 'it' ? `e ${count - 3} in più` : `and ${count - 3} more`))
      } finally { view.close() }
    }
  } finally { await f.close() }
})

test('actual page marks real waiting steps and phases; a finished plan occupies one current row', async () => {
  const { f, data } = await example()
  const view = await openPanel(data)
  try {
    assert.equal(view.root.querySelectorAll('.step.waiting .amber').length, 1)
    assert.equal(view.root.querySelectorAll('.phase .waiting-mark .amber').length, 1)
    const finished = data.plans.find(plan => plan.title === 'Zenit')!
    view.page.snapshot = { ...data, plans: [finished], activeRoot: finished.root, workspaceKey: 'other' }
    await view.emit('workspace.changed', { context })
    assert.equal(view.root.querySelectorAll('.row.plan.done').length, 1)
    assert.equal(view.root.querySelector('button.phase'), null)
    assert.equal(view.root.querySelector('header'), null)
    assert.match(view.root.querySelector('[aria-current="true"]')!.textContent, /Zenit/)
    assert.equal(view.root.querySelector('.amber'), null)
  } finally { view.close(); await f.close() }
})
