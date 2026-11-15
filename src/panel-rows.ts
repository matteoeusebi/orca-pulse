import { stepCount, type Translate } from './i18n'
import type { AgentView, AutomationView, PlanEntry, PlanView, Resources, RunView, TaskView } from './model'
import { currentPhase, finished, PanelState, phaseKey, planKey, stepKey, waiting } from './panel-state'
import { amber, barred, check, chevron, cross, dot, escape as e, idle, jump, pie, queue, spinner } from './panel-icons'

const icon = (content: string): string => `<span class="icon">${content}</span>`
export const message = (value: string, kind = ''): string => `<p class="message${kind ? ` ${kind}` : ''}">${e(value)}</p>`
const hidden = (value: string): string => `<span class="sr-only">${e(value)}</span>`
function count(plan: { done: number; total: number }, t: Translate): string {
  return `<span class="count"><span aria-hidden="true">${e(t('progress.count', plan))}</span>${hidden(stepCount(t, plan.done, plan.total))}</span>`
}
const mark = (t: Translate): string => `<span class="waiting-mark">${amber}${hidden(t('phase.waiting'))}</span>`
function agentRows(agents: readonly AgentView[], live: boolean, t: Translate): string {
  return agents.map(agent => {
    const glyph = agent.state === 'working' ? live ? spinner : dot : agent.state === 'done' ? queue : amber
    const place = agent.area && agent.area !== agent.name ? `<small class="verify">${e(agent.area)}</small>` : ''
    return `<div class="row agent">${icon(glyph)}<span class="name">${e(agent.name)}<span class="agent-state">${e(t(`agent.${agent.state}`))}</span></span>${place}</div>`
  }).join('')
}
export function planRow(plan: PlanEntry, t: Translate, overview = false, current = false): string {
  const key = e(planKey(plan))
  if (plan.kind === 'future') return `<button type="button" class="row plan" data-plan="${key}">${icon(queue)}<span class="name">${e(plan.title)}<span class="future-note">${e(t('plan.future'))}</span></span></button>`
  const done = finished(plan)
  const phase = currentPhase(plan)
  const step = phase?.steps.find(item => item.state !== 'done')
  const row = `${icon(done ? check : pie(plan.percent / 100))}<span class="name">${e(plan.title)}</span>${waiting(plan) ? mark(t) : ''}${count(plan, t)}`
  if (done) return `<div class="row plan done"${current ? ' aria-current="true"' : ''}>${hidden(t('step.done'))}${row}</div>`
  const next = overview && step ? `<span class="next-step">${icon(step.waiting ? amber : dot)}<span class="name">${e(step.title)}</span>${step.state === 'unknown' ? `<small class="verify">${e(t('step.unknown'))}</small>` : ''}</span>` : ''
  return `<button type="button" class="${overview ? 'overview' : 'row plan'}" data-plan="${key}">${overview ? `<span class="row">${row}</span>` : row}${next}</button>`
}

export function planDetails(plan: PlanView, state: PanelState, t: Translate): string {
  const phaseInProgress = currentPhase(plan)
  const current = phaseInProgress?.steps.find(step => step.state !== 'done')
  let html = plan.warning ? message(t('plan.warning')) : ''
  const live = !state.failed && !state.stale
  if (!plan.phases.length) html += message(t('plan.empty'))
  for (const [index, phase] of plan.phases.entries()) {
    const open = state.phaseOpen(plan, phase)
    const done = phase.state === 'done'
    const key = e(phaseKey(plan, phase))
    const phaseIcon = done ? check : phase.done > 0 ? pie(phase.done / phase.total) : queue
    const label = done ? 'phase.done' : phase.done > 0 ? 'phase.inProgress' : 'phase.notStarted'
    html += `<button type="button" class="row phase${done ? ' done' : ''}" data-phase="${key}" aria-expanded="${open}" aria-controls="phase-${index}">${icon(phaseIcon)}<span class="name">${e(phase.title)}</span>${waiting(plan, phase) ? mark(t) : hidden(t(label))}${count(phase, t)}${chevron}</button>`
    html += `<div id="phase-${index}"${open ? '' : ' hidden'}>`
    if (open) {
      if (!phase.steps.length) html += message(t('phase.empty'))
      for (const step of phase.steps) {
        const blocked = step.waiting && waiting(plan, phase)
        const working = step.working && !state.failed && !state.stale && plan.status !== 'done' && plan.status !== 'dropped'
        const isCurrent = step === current || working || !!step.focused
        const status = step.state === 'done' ? 'done' : blocked ? 'waiting' : isCurrent ? 'current' : 'queued'
        const glyph = step.state === 'done' ? check : blocked ? amber : isCurrent ? working ? spinner : dot : queue
        const label = step.state === 'done' ? t('step.done') : blocked ? t('phase.waiting') : isCurrent ? t(working ? 'step.working' : 'step.current') : t('step.open')
        const body = `${icon(glyph)}${hidden(label)}<span class="name">${e(step.title)}</span>${step.state === 'unknown' ? `<small class="verify">${e(t('step.unknown'))}</small>` : ''}`
        const classes = `row step ${status}${step.focused && status === 'current' ? ' here' : ''}`
        // Only a step with agents is a button: a click lists who is involved.
        if (step.agents?.length) {
          const toggle = stepKey(plan, phase, step), shown = state.agentsOpen(toggle)
          html += `<button type="button" class="${classes}" data-agents="${e(toggle)}" aria-expanded="${shown}">${body}${chevron}</button>`
          if (shown) html += agentRows(step.agents, live, t)
        } else html += `<div class="${classes}">${body}</div>`
      }
    }
    html += '</div>'
  }
  return html
}
/** Class names stay apart from catalog words, so a translated page never looks untranslated. */
const TASK_CLASS = { done: 't-ok', working: 't-run', blocked: 't-stop', failed: 't-bad', queued: 't-wait' } as const
function ago(since: number | undefined, t: Translate): string {
  if (!since) return ''
  const minutes = Math.max(0, Math.floor((Date.now() - since) / 60000))
  const [unit, count] = minutes < 60 ? ['minute', minutes] as const : minutes < 1440 ? ['hour', Math.floor(minutes / 60)] as const : ['day', Math.floor(minutes / 1440)] as const
  return minutes < 1 ? t('time.now') : t(`time.${unit}${count === 1 ? '' : 's'}`, { count })
}
/** One row per agent chat of the project: state and time in two fixed columns, never joined by a sign. */
export function chatsSection(chats: readonly AgentView[], state: PanelState, t: Translate): string {
  const live = !state.failed && !state.stale
  return `<section class="list chats"><h2 class="caption">${e(t('section.chats'))}</h2>${chats.map(chat => {
    const glyph = chat.state === 'working' ? live ? spinner : dot : chat.state === 'done' ? idle : amber
    const body = `${icon(glyph)}<span class="name">${e(chat.name)}</span><span class="col state">${e(t(`agent.${chat.state}`))}</span><span class="col time">${e(ago(chat.since, t))}</span>`
    const classes = `row chat${chat.state === 'done' ? ' idle' : ''}`
    return chat.terminal ? `<button type="button" class="${classes}" data-focus="${e(chat.terminal)}" title="${e(t('task.open'))}">${body}</button>`
      : `<div class="${classes}">${body}</div>`
  }).join('')}</section>`
}
const dash = '<span class="dash" aria-hidden="true"></span>'
/** "today 07:30", "tomorrow 07:30", otherwise the weekday: a schedule is read as a moment, not as a rule. */
export function when(at: number, locale: string, t: Translate, now = Date.now()): string {
  const day = (value: number): number => { const date = new Date(value); return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000 }
  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(at)
  const distance = day(at) - day(now)
  if (distance === 0) return t('when.today', { time })
  if (distance === 1) return t('when.tomorrow', { time })
  const date = distance > 1 && distance < 7 ? new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(at)
    : new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(at)
  return t('when.day', { day: date, time })
}
export function automationsSection(automations: readonly AutomationView[], locale: string, t: Translate): string {
  return `<section class="list automations"><h2 class="caption">${e(t('section.automations'))}</h2>${automations.map(item => {
    const glyph = item.last === 'ok' ? check : item.last === 'failed' ? cross : dash
    const outcome = item.last ? t(`automation.${item.last}`) : ''
    const next = !item.enabled ? t('automation.paused') : item.nextRunAt && item.nextRunAt > Date.now() ? when(item.nextRunAt, locale, t) : ''
    return `<div class="row chat${item.enabled ? '' : ' idle'}">${icon(glyph)}<span class="name">${e(item.name)}</span><span class="col state${item.last === 'failed' ? ' strong' : ''}">${e(outcome)}</span><span class="col next">${e(next)}</span></div>`
  }).join('')}</section>`
}
export const runKey = (run: RunView): string => `run:${run.id}`
const unfinished = (run: RunView): boolean => run.tasks.some(task => task.state === 'working' || task.state === 'queued' || task.state === 'blocked')
function taskRow(task: TaskView, live: boolean, t: Translate): string {
  const glyph = task.needsYou ? amber : task.state === 'done' ? check : task.state === 'failed' ? cross
    : task.state === 'blocked' ? barred : task.state === 'working' ? live ? spinner : dot : queue
  const body = `${icon(glyph)}<span class="name">${e(task.title)}</span>`
  const word = task.needsYou ? t('phase.waiting') : task.state === 'blocked' || task.state === 'failed' ? t(`task.${task.state}`) : ''
  // An agent with a terminal is a way into its chat; the word says why the row matters.
  if (task.agent) return `<button type="button" class="row task ${TASK_CLASS[task.state]}" data-focus="${e(task.agent.terminal)}">${body}${word ? `<span class="word">${e(word)}</span>` : ''}<span class="who">${e(task.agent.name)}</span>${jump}${hidden(t('task.open'))}</button>`
  return `<div class="row task ${TASK_CLASS[task.state]}">${body}${word ? `<span class="word">${e(word)}</span>` : hidden(t(`task.${task.state}`))}</div>`
}
/** Orchestrations of the focused project: what moves now first, finished tasks folded into one row. */
export function runsSection(runs: readonly RunView[], state: PanelState, t: Translate): string {
  const live = !state.failed && !state.stale
  let html = `<section class="list runs"><h2 class="caption">${e(t('section.runs'))}</h2>`
  for (const run of runs) {
    const key = runKey(run), shown = state.open(key, unfinished(run))
    const needsYou = run.tasks.some(task => task.needsYou)
    html += `<button type="button" class="row phase run" data-toggle="${e(key)}" data-default="${unfinished(run)}" aria-expanded="${shown}" title="${e(run.title)}">${icon(run.done === run.total ? check : pie(run.done / run.total))}<span class="name">${e(run.title)}</span>${needsYou ? mark(t) : ''}${run.failed ? `<span class="flag">${cross}${hidden(t('task.failed'))}</span>` : ''}${count(run, t)}${chevron}</button>`
    if (!shown) continue
    const open = run.tasks.filter(task => task.state !== 'done'), done = run.tasks.filter(task => task.state === 'done')
    // The one that waits for the owner goes on top of its run.
    html += [...open.filter(task => task.needsYou), ...open.filter(task => !task.needsYou)].map(task => taskRow(task, live, t)).join('')
    if (done.length) {
      const doneKey = `${key}:done`, listed = state.open(doneKey, false)
      html += `<button type="button" class="row task t-ok" data-toggle="${e(doneKey)}" data-default="false" aria-expanded="${listed}">${icon(check)}<span class="name">${e(t('task.doneCount', { count: done.length }))}</span>${chevron}</button>`
      if (listed) html += done.map(task => taskRow(task, live, t)).join('')
    }
  }
  return html + '</section>'
}
export function header(title: string, plan: { done: number; total: number; percent?: number } | null, t: Translate, current = false, working = false): string {
  return `<header><h1${current ? ' aria-current="true"' : ''}>${e(title)}</h1>${working ? icon(spinner) + hidden(t('plan.working')) : ''}${plan ? count(plan, t) : ''}${plan?.percent !== undefined ? `<span class="percent">${e(t('progress.percent', { percent: plan.percent }))}</span>` : ''}</header>`
}
export function resourcesLine(resources: Resources, t: Translate): string {
  return `<footer class="resources ${resources.light}"><span class="name">${e(t(`resources.${resources.light}`))}</span><span class="count">${e(t('resources.slots', resources))}</span></footer>`
}
