import type { PhaseView, PlanEntry, PlanView, Snapshot } from './model'

export const planKey = (plan: PlanEntry): string => `${plan.root}/${plan.file}`
export const phaseKey = (plan: PlanEntry, phase: PhaseView): string => `${planKey(plan)}:${phase.id}`
export const stepKey = (plan: PlanEntry, phase: PhaseView, step: { id: string }): string => `${phaseKey(plan, phase)}:${step.id}`
export const finished = (plan: PlanView): boolean => plan.total > 0 && plan.done === plan.total
export const waiting = (plan: PlanView, phase?: PhaseView): boolean => !finished(plan) && plan.status !== 'done' && plan.status !== 'dropped'
  && (phase ? phase.steps : plan.phases.flatMap(item => item.steps)).some(step => step.waiting)
export function currentPhase(plan: PlanView): PhaseView | undefined {
  if (finished(plan) || plan.status === 'done' || plan.status === 'dropped') return undefined
  return plan.phases.find(phase => phase.steps.length && (phase.state === 'inProgress' || phase.state === 'waiting'))
    ?? plan.phases.find(phase => phase.steps.length && phase.state !== 'done')
}

/** Expansion is kept in this panel, never written to project files or plugin storage. */
export class PanelState {
  snapshot: Snapshot | null = null
  failed = false
  selected: string | null = null
  private choices = new Map<string, boolean>()
  private completed = new Set<string>()
  private waitingPhases = new Set<string>()
  /** Agent lists the owner opened: closed by default, forgotten with the workspace. */
  private agentLists = new Set<string>()
  get currentPlan(): PlanEntry | undefined {
    const plans = this.snapshot?.plans ?? []
    return plans.find(plan => planKey(plan) === this.selected)
      ?? plans.find(plan => plan.root === this.snapshot?.activeRoot)
  }
  get stale(): boolean {
    return !!this.snapshot && (this.snapshot.lastSuccessAt === null || Date.now() - this.snapshot.lastSuccessAt > 60000)
  }
  accept(snapshot: Snapshot): void {
    if (this.snapshot?.workspaceKey !== snapshot.workspaceKey) this.reset()
    const completed = new Set<string>()
    const waitingPhases = new Set<string>()
    for (const plan of snapshot.plans) if (plan.kind === 'plan') for (const phase of plan.phases) {
      const key = phaseKey(plan, phase)
      if (waiting(plan, phase)) {
        waitingPhases.add(key)
        if (!this.waitingPhases.has(key)) this.choices.delete(key)
      }
      if (phase.state === 'done') {
        completed.add(key)
        if (!this.completed.has(key)) this.choices.set(key, false)
      } else if (this.completed.has(key)) this.choices.delete(key)
    }
    this.completed = completed
    this.waitingPhases = waitingPhases
    this.snapshot = snapshot
    this.failed = false
    if (!snapshot.plans.some(plan => planKey(plan) === this.selected)) this.selected = null
  }
  reset(): void { this.selected = null; this.choices.clear(); this.completed.clear(); this.waitingPhases.clear(); this.agentLists.clear() }
  clearFocus(): void {
    this.reset()
    if (this.snapshot) this.snapshot = { ...this.snapshot, activeRoot: null, activeName: null, workspaceKey: null }
  }
  selectPlan(key: string): void {
    if (this.snapshot?.plans.some(plan => planKey(plan) === key)) this.selected = key
  }
  phaseOpen(plan: PlanView, phase: PhaseView): boolean {
    return this.choices.get(phaseKey(plan, phase)) ?? (phase.state !== 'done'
      && (phase === currentPhase(plan) || waiting(plan, phase) || phase.steps.length === 0 || phase.steps.some(step => step.focused)))
  }
  /** A row the panel opens or closes on its own until the owner chooses. */
  open(key: string, fallback: boolean): boolean { return this.choices.get(key) ?? fallback }
  toggle(key: string, fallback: boolean): void { this.choices.set(key, !this.open(key, fallback)) }
  agentsOpen(key: string): boolean { return this.agentLists.has(key) }
  toggleAgents(key: string): void { if (!this.agentLists.delete(key)) this.agentLists.add(key) }
  togglePhase(plan: PlanView, phase: PhaseView): void { this.choices.set(phaseKey(plan, phase), !this.phaseOpen(plan, phase)) }
}
