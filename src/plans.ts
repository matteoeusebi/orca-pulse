import { readdir } from 'node:fs/promises'
import { basename } from 'node:path'
import { allowedPath, reasonOf, safeRoot, safeStat } from './files'
import { PlanFileCache } from './plan-cache'
import { gitTagState } from './git-tags'
import { parsePlan, record, validDate, type PhaseView, type PlanView, type ProjectRead, type Step, type StepView } from './model'

async function evaluate(root: string, step: Step): Promise<StepView> {
  const rule = step.doneWhen
  let state: StepView['state'] = 'unknown'
  let waiting = false
  if (record(rule)) {
    const types = ['file', 'manual', 'approval', 'gitTag'].filter((key) => Object.hasOwn(rule, key))
    if (types.length === 1) {
      if (typeof rule.manual === 'boolean') state = rule.manual ? 'done' : 'open'
      else if (Object.hasOwn(rule, 'approval')) {
        waiting = rule.approval === '' || rule.approval === null
        state = validDate(rule.approval) ? 'done' : waiting ? 'open' : 'unknown'
      } else if (typeof rule.gitTag === 'string') state = await gitTagState(root, rule.gitTag)
      else if (typeof rule.file === 'string' && allowedPath(root, rule.file)) {
        try { state = (await safeStat(root, rule.file)).isFile() ? 'done' : 'unknown' }
        catch (error) { state = reasonOf(error) === 'missing' ? 'open' : 'unknown' }
      }
    }
  }
  return { ...step, state, waiting }
}

/** Errors are isolated to their plan; a future version does not pass through v1 validation. */
export async function readProject(root: string, cache = new PlanFileCache()): Promise<ProjectRead> {
  const result: ProjectRead = { plans: [], errors: [] }
  let entries: string[]
  try {
    await safeRoot(root)
    if (!(await safeStat(root, 'plans')).isDirectory()) throw { reason: 'unsafePath' }
    entries = await readdir(`${root}/plans`)
  } catch (error) {
    if (reasonOf(error) !== 'missing') result.errors.push({ file: root, reason: reasonOf(error) })
    return result
  }
  for (const name of entries.filter((name) => name.endsWith('.plan.json')).sort()) {
    const file = `plans/${name}`
    try {
      const value = await cache.load(root, file)
      if (record(value) && Number.isInteger(value.schemaVersion) && Number(value.schemaVersion) > 1) {
        result.plans.push({ kind: 'future', root, file, title: typeof value.title === 'string' ? value.title.slice(0, 1000) : basename(file) })
        continue
      }
      const plan = parsePlan(value)
      if (!plan) throw { reason: 'invalidPlan' }
      const phases: PhaseView[] = []
      for (const phase of plan.phases) {
        const steps = await Promise.all(phase.steps.map((step) => evaluate(root, step)))
        const done = steps.filter((step) => step.state === 'done').length
        const total = steps.length
        const state = total > 0 && done === total ? 'done' : steps.some((step) => step.waiting) ? 'waiting' : done > 0 ? 'inProgress' : 'notStarted'
        phases.push({ ...phase, steps, state, done, total, percent: total ? Math.floor(done * 100 / total) : 0,
          next: steps.find((step) => step.state !== 'done')?.title ?? null })
      }
      const weights = { s: 1, m: 3, l: 8 }
      const sized = phases.some((phase) => phase.size !== undefined)
      let weight = 0
      let completedWeight = 0
      for (const phase of phases) {
        const share = phase.total ? sized ? weights[phase.size ?? 'm'] : phase.total : 0
        weight += share
        completedWeight += phase.total ? share * phase.done / phase.total : 0
      }
      const done = phases.reduce((sum, phase) => sum + phase.done, 0)
      const total = phases.reduce((sum, phase) => sum + phase.total, 0)
      const view: PlanView = { ...plan, kind: 'plan', root, file, phases, done, total,
        percent: total > 0 && done === total ? 100 : weight ? Math.min(99, Math.floor(completedWeight * 100 / weight)) : 0,
        warning: phases.some((phase) => phase.steps.some((step) => step.state === 'unknown')) }
      result.plans.push(view)
    } catch (error) { result.errors.push({ file: `${root}/${file}`, reason: reasonOf(error) }) }
  }
  return result
}
