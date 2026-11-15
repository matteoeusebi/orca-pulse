import type { AgentState, AgentView, PlanEntry, Step } from './model'
import { cleanTitle } from './orchestration'
import { matchesWorkspace, type Context, type Workspace } from './workspace'

type Agent = { terminalId: string | null; state: string; title?: string | null; agent?: string | null; stateStartedAt?: number }
export type Activity = { root: string; branch: string | null; state: string; name?: string | null; area?: string; terminal?: string | null; since?: number }
/** Listing order: who works first, who is idle last. */
const STATES: readonly AgentState[] = ['working', 'waiting', 'blocked', 'done']
function views(agents: readonly Activity[], order: readonly AgentState[] = STATES): AgentView[] {
  return order.flatMap(state => agents.filter(agent => agent.state === state)
    .map(agent => ({ name: cleanTitle(agent.name) || agent.area || '', area: agent.area ?? '', state })))
}
/** In the chat list whoever waits for a person comes first. */
const CHAT_ORDER: readonly AgentState[] = ['waiting', 'blocked', 'working', 'done']
/** Every agent chat of one project, with the way into it; `skip` holds terminals already shown elsewhere. */
export function projectChats(activity: readonly Activity[], root: string, skip: ReadonlySet<string> = new Set()): AgentView[] {
  const mine = activity.filter(agent => agent.root === root && !(agent.terminal && skip.has(agent.terminal)))
  return CHAT_ORDER.flatMap(state => mine.filter(agent => agent.state === state).map(agent => ({
    ...views([agent])[0], ...(agent.terminal ? { terminal: agent.terminal } : {}), ...(agent.since ? { since: agent.since } : {}) })))
}

export function projectActivity(workspaces: Workspace[], roots: Map<string, string>, events: { workspaceId: string; state?: string; title?: string; terminalId?: string; receivedAt?: number }[],
  focused: Workspace | null, context: Context, agents: { agents: Agent[] } | null): Activity[] {
  const activity: Activity[] = []
  for (const event of events) {
    const matches = workspaces.filter(area => matchesWorkspace(event.workspaceId, area))
    if (matches.length !== 1 || !event.state) continue
    const area = matches[0], root = roots.get(area.id)
    if (root && !(agents && area.id === focused?.id)) activity.push({ root, branch: area.branch, state: event.state, name: event.title ?? null, area: area.name,
      terminal: event.terminalId ?? null, since: event.receivedAt })
  }
  const root = focused && roots.get(focused.id)
  if (root && agents) for (const agent of agents.agents) {
    if (context?.terminals.some(terminal => terminal.id === agent.terminalId)) activity.push({ root, branch: focused.branch, state: agent.state, name: agent.title ?? agent.agent ?? null, area: focused.name,
      terminal: agent.terminalId, since: agent.stateStartedAt })
  }
  return activity
}

export function matchesWork(step: Step, branch: string | null): boolean {
  const pattern = step.work?.branch
  return !!pattern && branch !== null && (pattern.endsWith('*') ? branch.startsWith(pattern.slice(0, -1)) : branch === pattern)
}

/** Activity changes indicators, never factual completion, counts or percentages. */
export function applyActivity(plans: readonly PlanEntry[], activity: readonly Activity[], focus?: { root: string; branch: string | null } | null): PlanEntry[] {
  return plans.map(plan => {
    if (plan.kind !== 'plan' || plan.status === 'done' || plan.status === 'dropped' || (plan.total > 0 && plan.done === plan.total)) return plan
    const agents = activity.filter(agent => agent.root === plan.root)
    // One step only: the first open one on the focused branch is the one the owner is looking at.
    const here = focus?.root === plan.root
      ? plan.phases.flatMap(phase => phase.steps).find(step => step.state !== 'done' && matchesWork(step, focus.branch)) : undefined
    const phases = plan.phases.map(phase => {
      const steps = phase.steps.map(step => {
        if (step.state === 'done') return step
        const matching = agents.filter(agent => matchesWork(step, agent.branch))
        const waiting = step.waiting || matching.some(agent => agent.state === 'waiting' || agent.state === 'blocked')
        const focused = step === here
        const involved = views(matching)
        return { ...step, waiting, working: !waiting && matching.some(agent => agent.state === 'working'), ...(focused ? { focused } : {}),
          ...(involved.length ? { agents: involved } : {}) }
      })
      return { ...phase, steps, state: steps.some(step => step.waiting) ? 'waiting' as const : phase.state }
    })
    const spinning = phases.flatMap(phase => phase.steps).filter(step => step.state !== 'done' && step.working)
    const working = agents.some(agent => agent.state === 'working' && !spinning.some(step => matchesWork(step, agent.branch)))
    // Agents of the project that no open step claims are listed once, at plan level.
    const open = phases.flatMap(phase => phase.steps).filter(step => step.state !== 'done')
    const loose = views(agents.filter(agent => !open.some(step => matchesWork(step, agent.branch))))
    return { ...plan, phases, working, ...(loose.length ? { agents: loose } : {}) }
  })
}
