import type { OrcaWorkerApi } from 'orca/worker'
import type {} from './protocol'
import { basename } from 'node:path'
import { readProject } from './plans'
import { PlanFileCache } from './plan-cache'
import { projectRoot, TerminalWorkspaces, type Context } from './workspace'
import type { ProjectRead, Snapshot } from './model'
import { applyActivity, projectActivity, projectChats } from './activity'
import { FocusedWorkspace } from './focus'
import { external } from './external'

/** After a failed terminal lookup, wait before spawning the CLI again. */
const LOOKUP_RETRY_MS = 15000
/** Orchestrations one project shows at once. */
const RUNS_SHOWN = 6
const HANDLE = /^term_[\w-]+$/

export default function activate(orca: OrcaWorkerApi): void {
  const terminals = new TerminalWorkspaces()
  const cache = new PlanFileCache()
  const focus = new FocusedWorkspace()
  let lastSuccessAt: number | null = null
  let inFlight: Promise<Snapshot> | null = null
  // A terminal never changes folder: one lookup per terminal of the focused context, kept only while it stays there.
  let folders = new Map<string, string | null>()
  let retryAt = 0
  let offered = new Set<string>()
  const locate = async (context: Context): Promise<ReadonlyMap<string, string>> => {
    const ids = context?.terminals.map(terminal => terminal.id) ?? []
    const kept = new Map(ids.filter(id => folders.has(id)).map(id => [id, folders.get(id)!] as const))
    if (ids.some(id => !kept.has(id)) && Date.now() >= retryAt) {
      const found = await external.terminalPaths().catch(() => null)
      // No answer proves nothing: ask again later instead of recording the terminals as unknown.
      if (found) { for (const id of ids) if (!kept.has(id)) kept.set(id, found.get(id) ?? null) }
      else retryAt = Date.now() + LOOKUP_RETRY_MS
    }
    folders = kept
    return new Map([...kept].filter((entry): entry is [string, string] => entry[1] !== null))
  }
  orca.events.on('agent.status.changed', (event) => terminals.record(event))
  orca.events.on('workspace.removed', (event) => terminals.removeWorkspace(event))
  const collect = async (): Promise<Snapshot> => {
    const [list, context, agents] = await Promise.all([
      orca.host.call('workspace.list'),
      orca.host.call('workspace.readContext'),
      orca.host.call('agents.list').catch(() => null)
    ])
    const [paths, resources, allRuns, allAutomations] = await Promise.all([locate(context), external.resources().catch(() => null),
      external.orchestrations().catch(() => []), external.automations().catch(() => [])])
    const active = focus.resolve(context, list, terminals, paths)
    const result: ProjectRead = { plans: [], errors: [] }
    const roots = new Map<string, string>()
    for (const area of list.workspaces) {
      if (area.hostId !== null && area.hostId !== 'local') { result.errors.push({ file: area.path, reason: 'remote' }); continue }
      const root = await projectRoot(area.path)
      if (root) roots.set(area.id, root)
      else result.errors.push({ file: area.path, reason: 'read' })
    }
    for (const root of new Set(roots.values())) {
      const project = await readProject(root, cache)
      result.plans.push(...project.plans)
      result.errors.push(...project.errors)
    }
    const activeRoot = active ? roots.get(active.id) ?? null : null
    const activity = projectActivity(list.workspaces, roots, terminals.activity(list.workspaces, active), active, context, agents)
    const plans = applyActivity(result.plans, activity,
      active && activeRoot ? { root: activeRoot, branch: active.branch } : null)
    // A run belongs to the project of the chat that coordinates it; an automation to the project of the folder it runs in.
    const inProject = (path: string | null): boolean => !!activeRoot && list.workspaces.some(area => area.path === path && roots.get(area.id) === activeRoot)
    const runs = allRuns.filter(run => inProject(run.path)).slice(0, RUNS_SHOWN)
    const automations = allAutomations.filter(automation => inProject(automation.path))
    // A worker already listed under its task is not repeated among the chats.
    const workers = new Set(runs.flatMap(run => run.tasks.flatMap(task => task.agent ? [task.agent.terminal] : [])))
    const chats = activeRoot ? projectChats(activity, activeRoot, workers) : []
    // Only a terminal the panel was shown can be asked for.
    offered = new Set([...workers, ...chats.flatMap(chat => chat.terminal ? [chat.terminal] : [])])
    const readAt = Date.now()
    if (!list.truncated) lastSuccessAt = readAt
    return { ...result, plans, activeRoot, activeName: activeRoot ? basename(activeRoot) : null,
      workspaceKey: active?.id ?? null, lastSuccessAt, readAt, truncated: list.truncated, resources, ...(runs.length ? { runs } : {}), ...(chats.length ? { chats } : {}),
      ...(automations.length ? { automations } : {}) }
  }
  orca.panels.handle('plans.focus', async input => {
    const handle = input?.terminal
    if (typeof handle !== 'string' || !HANDLE.test(handle) || !offered.has(handle)) return { ok: false }
    return { ok: await external.focusTerminal(handle).catch(() => false) }
  })
  orca.panels.handle('plans.read', () => {
    if (!inFlight) inFlight = collect().finally(() => { inFlight = null })
    return inFlight
  })
}
