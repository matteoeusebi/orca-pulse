import { record } from './model'
import type { AutomationView, RunView, TaskState, TaskView } from './model'

/** Orca orchestration read through its CLI: any Orca user has it, no file of ours is needed. */
export type Terminal = { handle: string; path: string | null; title: string | null }
export type RawRun = { id: string; objective: string; coordinator: string | null; createdAt: number }
export type RawTask = { id: string; title: string; status: string }
export type RawWorker = { taskId: string; terminal: string | null; provider: string | null; needsYou: boolean }

const MAX_TITLE = 120
/** A finished run stays visible this long, then it is history, not "what is happening". */
export const FINISHED_RUN_TTL_MS = 12 * 60 * 60 * 1000
const FINAL = new Set(['completed', 'failed'])
/** What matters now comes first; done tasks are folded into one row by the panel. */
const ORDER: readonly TaskState[] = ['working', 'blocked', 'failed', 'queued', 'done']

const text = (value: unknown): string | null => typeof value === 'string' && value.trim() ? value : null
const rows = (value: unknown, key: string): unknown[] => {
  const result = record(value) && record(value.result) ? value.result[key] : null
  return Array.isArray(result) ? result : []
}
/** Objectives are free text, often long: one line, bounded. */
export function shortTitle(value: string): string {
  const line = (value.split('\n').find(part => part.trim()) ?? '').replace(/\s+/g, ' ').trim()
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1).trimEnd()}…` : line
}
/** Terminal titles carry a spinner frame or a status mark in front: it would change at every read. */
export function cleanTitle(title: string | null | undefined): string {
  return (title ?? '').replace(/^[^\p{L}\p{N}]+/u, '').trim()
}

export function parseTerminals(value: unknown): Terminal[] {
  return rows(value, 'terminals').flatMap(item => record(item) && typeof item.handle === 'string'
    ? [{ handle: item.handle, path: text(item.worktreePath), title: text(item.title) }] : [])
}
export function parseRuns(value: unknown): RawRun[] {
  return rows(value, 'runs').flatMap(item => record(item) && typeof item.id === 'string'
    ? [{ id: item.id, objective: text(item.objective) ?? '', coordinator: text(item.coordinator_handle),
        // The newest time Orca recorded for the run; a long run is not "old" the moment it ends.
        createdAt: Math.max(Date.parse(String(item.created_at)) || 0, Date.parse(String(item.updated_at)) || 0) }] : [])
}
export function parseTasks(value: unknown): RawTask[] {
  return rows(value, 'tasks').flatMap(item => record(item) && typeof item.id === 'string'
    ? [{ id: item.id, title: text(item.title) ?? text(item.task_title) ?? item.id, status: text(item.status) ?? '' }] : [])
}
export function parseWorkers(value: unknown): RawWorker[] {
  return rows(value, 'workers').flatMap(item => {
    if (!record(item) || typeof item.taskId !== 'string') return []
    const projection = record(item.projection) ? item.projection : {}
    const provider = record(projection.provider) ? text(projection.provider.id) : null
    const attention = record(projection.attention) ? projection.attention.requiresAction === true : false
    return [{ taskId: item.taskId, terminal: text(item.agentTerminalHandle) ?? text(item.terminal), provider, needsYou: attention }]
  })
}

function taskState(status: string): TaskState {
  return status === 'completed' ? 'done' : status === 'failed' ? 'failed' : status === 'blocked' ? 'blocked'
    : status === 'dispatched' ? 'working' : 'queued'
}
/** A run is live while the chat that coordinates it is open; null when it is not worth showing. */
export function runView(run: RawRun, tasks: readonly RawTask[], workers: readonly RawWorker[],
  terminals: readonly Terminal[], now = Date.now()): RunView | null {
  const coordinator = terminals.find(terminal => terminal.handle === run.coordinator)
  if (!coordinator || !tasks.length) return null
  if (tasks.every(task => FINAL.has(task.status)) && now - run.createdAt > FINISHED_RUN_TTL_MS) return null
  const views = tasks.map((task): TaskView => {
    const state = taskState(task.status)
    // The newest dispatch of a task is listed first.
    const worker = state === 'done' ? undefined : workers.find(item => item.taskId === task.id)
    const terminal = terminals.find(item => item.handle === worker?.terminal)
    return { id: task.id, title: shortTitle(task.title), state,
      ...(terminal ? { agent: { name: cleanTitle(terminal.title) || worker?.provider || terminal.handle, terminal: terminal.handle } } : {}),
      // Orca's attention flag also marks dead workers, which is the coordinator's business: only a live agent can wait for a person.
      ...(worker?.needsYou && terminal && state !== 'failed' ? { needsYou: true } : {}) }
  })
  return { id: run.id, title: shortTitle(run.objective) || run.id, path: coordinator.path,
    done: views.filter(task => task.state === 'done').length, total: views.length,
    failed: views.filter(task => task.state === 'failed').length,
    tasks: ORDER.flatMap(state => views.filter(task => task.state === state)) }
}

function lastResult(status: unknown): AutomationView['last'] {
  const value = typeof status === 'string' ? status : ''
  return value === 'completed' ? 'ok' : value.startsWith('skipped') ? 'skipped' : /fail|error|timed_out|cancel/.test(value) ? 'failed' : null
}
/** Scheduled automations with the outcome of their last run; an unknown status is shown as no outcome. */
export function parseAutomations(value: unknown): AutomationView[] {
  const last = new Map(rows(value, 'items').flatMap(item => record(item) && typeof item.automationId === 'string' && record(item.usageSummary)
    ? [[item.automationId, lastResult(item.usageSummary.lastRunStatus)] as const] : []))
  return rows(value, 'automations').flatMap(item => record(item) && typeof item.id === 'string' ? [{
    id: item.id, name: shortTitle(text(item.name) ?? '') || item.id,
    path: record(item.runContext) ? text(item.runContext.path) : null, enabled: item.enabled !== false,
    nextRunAt: typeof item.nextRunAt === 'number' && Number.isFinite(item.nextRunAt) ? item.nextRunAt : null,
    last: last.get(item.id) ?? null }] : [])
}
