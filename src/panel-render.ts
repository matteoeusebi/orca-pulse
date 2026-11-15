import { translator } from './i18n'
import { finished, PanelState } from './panel-state'
import { header, message, planDetails, planRow, automationsSection, chatsSection, resourcesLine, runsSection } from './panel-rows'
import { escape as e } from './panel-icons'

function errorName(file: string): string {
  const parts = file.split(/[\\/]/).filter(Boolean)
  const last = parts.at(-1) ?? file
  return parts.at(-2) === 'plans' && parts.length > 2 ? `${parts.at(-3)}/${last}` : last
}
export function renderPanel(state: PanelState, locale: string): string {
  const t = translator(locale)
  const data = state.snapshot
  const selected = state.currentPlan
  let html = ''
  const runs = data?.runs ?? [], chats = data?.chats ?? [], automations = data?.automations ?? []
  const sections = runs.length + chats.length + automations.length > 0
  if (selected?.kind === 'plan' && !finished(selected)) html += header(selected.title, selected, t, true, !!selected.working && !state.failed && !state.stale)
  else if (!selected && !data?.activeRoot) {
    const known = data?.plans.filter(plan => plan.kind === 'plan') ?? []
    html += header(t('app.allPlans'), known.length ? {
      done: known.reduce((sum, plan) => sum + plan.done, 0), total: known.reduce((sum, plan) => sum + plan.total, 0)
    } : null, t)
  }
  if (state.failed) html += message(t('app.refreshFailed'))
  if (!data && !state.failed) html += message(t('app.loading'))
  if (state.stale) html += message(t('app.stale'))
  if (data?.truncated) html += message(t('app.truncated'))
  for (const error of data?.errors.slice(0, 3) ?? []) html += message(t('error.row', { file: errorName(error.file), reason: t(`error.${error.reason}`) }), 'error')
  if (data && data.errors.length > 3) html += message(t('error.more', { count: data.errors.length - 3 }))
  if (data && !data.plans.length && !data.activeRoot) html += message(t('app.empty'))
  // A project without a written plan still has a name; "no plan" is said only when nothing else is shown.
  if (data?.activeRoot && !selected) html += sections ? header(data.activeName ?? data.activeRoot, null, t, true)
    : message(t('app.noPlan', { project: data.activeName ?? data.activeRoot }))
  if (runs.length) html += runsSection(runs, state, t)
  if (chats.length) html += chatsSection(chats, state, t)
  if (automations.length) html += automationsSection(automations, locale, t)
  if (selected) {
    if (selected.kind === 'future') html += header(selected.title, null, t, true) + message(t('plan.future'))
    else html += `<section class="list">${sections && !finished(selected) ? `<h2 class="caption">${e(t('section.plan'))}</h2>` : ''}${finished(selected) ? planRow(selected, t, false, true) : planDetails(selected, state, t)}</section>`
  }
  // A focused project shows only its own plans: other projects never appear beside it.
  const focus = data?.activeRoot
  const others = data?.plans.filter(plan => plan !== selected && (!focus || plan.root === focus)) ?? []
  if (others.length) {
    const overview = !selected && !focus
    html += overview ? '<section class="overviews">' : `<section class="others"><h2 class="caption">${e(t('group.other'))}</h2>`
    html += others.map(plan => planRow(plan, t, overview)).join('') + '</section>'
  }
  if (data?.resources) html += resourcesLine(data.resources, t)
  return html
}
