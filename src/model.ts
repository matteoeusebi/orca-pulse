export type StepState = 'done' | 'open' | 'unknown'
export type PhaseState = 'done' | 'waiting' | 'inProgress' | 'notStarted'
export type Reason = 'invalidJson' | 'invalidPlan' | 'permission' | 'missing' | 'unsafePath' | 'read' | 'remote'
export type Step = { id: string; title: string; doneWhen?: unknown; work?: { branch: string } }
export type Phase = { id: string; title: string; size?: 's' | 'm' | 'l'; steps: Step[] }
export type Plan = { schemaVersion: 1; id: string; title: string; status: 'proposed' | 'approved' | 'done' | 'dropped'; approvedOn?: string; phases: Phase[] }
export type AgentState = 'working' | 'waiting' | 'blocked' | 'done'
export type AgentView = { name: string; area: string; state: AgentState; terminal?: string; since?: number }
export type StepView = Step & { state: StepState; waiting: boolean; working?: boolean; focused?: boolean; agents?: AgentView[] }
export type PhaseView = Omit<Phase, 'steps'> & { steps: StepView[]; state: PhaseState; done: number; total: number; percent: number; next: string | null }
export type PlanView = Omit<Plan, 'phases'> & { kind: 'plan'; root: string; file: string; phases: PhaseView[]; done: number; total: number; percent: number; warning: boolean; working?: boolean; agents?: AgentView[] }
export type FuturePlan = { kind: 'future'; root: string; file: string; title: string }
export type PlanEntry = PlanView | FuturePlan
export type ReadError = { file: string; reason: Reason }
export type ProjectRead = { plans: PlanEntry[]; errors: ReadError[] }
export type Resources = { light: 'green' | 'yellow' | 'red'; used: number; max: number }
export type TaskState = 'done' | 'working' | 'blocked' | 'failed' | 'queued'
export type TaskView = { id: string; title: string; state: TaskState; agent?: { name: string; terminal: string }; needsYou?: boolean }
export type RunView = { id: string; title: string; path: string | null; done: number; total: number; failed: number; tasks: TaskView[] }
export type AutomationView = { id: string; name: string; path: string | null; enabled: boolean; nextRunAt: number | null; last: 'ok' | 'skipped' | 'failed' | null }
export type Snapshot = ProjectRead & { activeRoot: string | null; activeName: string | null; workspaceKey: string | null; lastSuccessAt: number | null; readAt: number; truncated: boolean; resources?: Resources | null; runs?: RunView[]; chats?: AgentView[]; automations?: AutomationView[] }

export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
export function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
const title = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 1000
export const validWorkBranch = (value: unknown): value is string => typeof value === 'string'
  && value.length <= 1000 && /^[^*\s\x00-\x1f\x7f]+\*?$/.test(value)
function unique(items: unknown[]): boolean { return new Set(items).size === items.length }
export function parsePlan(value: unknown): Plan | null {
  if (!record(value) || value.schemaVersion !== 1 || !id(value.id) || !title(value.title)
    || !['proposed', 'approved', 'done', 'dropped'].includes(value.status as string)
    || (value.approvedOn !== undefined && !validDate(value.approvedOn)) || !Array.isArray(value.phases)) return null
  const phases: Phase[] = []
  for (const phase of value.phases) {
    if (!record(phase) || !id(phase.id) || !title(phase.title) || !Array.isArray(phase.steps)
      || (phase.size !== undefined && !['s', 'm', 'l'].includes(phase.size as string))) return null
    const steps: Step[] = []
    for (const step of phase.steps) {
      if (!record(step) || !id(step.id) || !title(step.title)) return null
      if (step.work !== undefined && (!record(step.work) || !validWorkBranch(step.work.branch))) return null
      steps.push({ id: step.id, title: step.title, ...(step.doneWhen === undefined ? {} : { doneWhen: step.doneWhen }),
        ...(record(step.work) ? { work: { branch: step.work.branch as string } } : {}) })
    }
    if (!unique(steps.map((step) => step.id))) return null
    phases.push({ id: phase.id, title: phase.title, ...(phase.size ? { size: phase.size as Phase['size'] } : {}), steps })
  }
  if (!unique(phases.map((phase) => phase.id))) return null
  return { schemaVersion: 1, id: value.id, title: value.title, status: value.status as Plan['status'],
    ...(value.approvedOn ? { approvedOn: value.approvedOn as string } : {}), phases }
}
