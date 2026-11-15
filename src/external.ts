import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { record } from './model'
import type { AutomationView, Resources, RunView } from './model'
import { parseAutomations, parseRuns, parseTasks, parseTerminals, parseWorkers, runView } from './orchestration'

/** Facts the plugin API does not expose are read from local tools; every failure means "unknown". */
const COMMAND_TIMEOUT_MS = 2000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const RESOURCES_TTL_MS = 30000
const RUNS_TTL_MS = 5000
const AUTOMATIONS_TTL_MS = 30000
/** Newest runs looked at, and how many live ones are read in full; the worker caps what one project shows. */
const RUNS_SCANNED = 50
const RUNS_READ = 12
/** After this long without a good read, old runs and schedules are dropped instead of shown as current. */
const MAX_AGE_MS = 120000
/** The worker runs inside the Orca app bundle; its CLI ships in the same bundle. */
function bundledCli(): string | null {
  const marker = '.app/Contents/'
  const end = process.execPath.indexOf(marker)
  return end < 0 ? null : join(process.execPath.slice(0, end + marker.length), 'Resources', 'bin', 'orca')
}
// Never a bare `orca` from PATH: on some desktops that name is another program.
const ORCA_CLI = [process.env.ORCA_CLI, bundledCli()].filter((path): path is string => !!path)
/** Optional: a local tool may report how loaded the machine is. Without this file the footer is not shown. */
const RESOURCES_CONFIG = join(homedir(), '.config', 'orca-pulse', 'resources.json')
const LIGHTS = new Set(['green', 'yellow', 'red'])

const reported = new Set<string>()
/** One line per distinct failure, so a missing tool is visible in `orca plugin logs` without flooding it. */
function report(command: string, reason: string): void {
  // Program name and a short code only: arguments, paths and output never reach the log.
  const key = `${basename(command)}: ${reason}`
  if (reported.has(key) || reported.size >= 32) return
  reported.add(key)
  console.warn(`pulse: ${key}`)
}
function runJson(command: string, args: string[]): Promise<unknown> {
  return new Promise(resolve => {
    try {
      execFile(command, args, { timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_BYTES, windowsHide: true }, (error, stdout) => {
        // A provider may answer and still exit non-zero; only its JSON counts.
        try { resolve(JSON.parse(String(stdout))) }
        catch { report(command, error ? String((error as NodeJS.ErrnoException).code ?? error.signal ?? 'failed') : 'answer is not JSON'); resolve(null) }
      })
    } catch { report(command, 'could not start'); resolve(null) }
  })
}

export function parseTerminalPaths(value: unknown): Map<string, string> {
  const paths = new Map<string, string>()
  const terminals = record(value) && record(value.result) ? value.result.terminals : null
  if (!Array.isArray(terminals)) return paths
  for (const terminal of terminals) {
    if (record(terminal) && typeof terminal.handle === 'string' && typeof terminal.worktreePath === 'string') paths.set(terminal.handle, terminal.worktreePath)
  }
  return paths
}

/** The provider prints `{ "light": "green" | "yellow" | "red", "used": n, "max": n }`. */
export function parseResources(value: unknown): Resources | null {
  if (!record(value) || typeof value.light !== 'string' || !LIGHTS.has(value.light)) return null
  const used = value.used, max = value.max
  if (!Number.isInteger(used) || !Number.isInteger(max) || (used as number) < 0 || (max as number) < 1) return null
  return { light: value.light as Resources['light'], used: used as number, max: max as number }
}
/** `{ "command": ["program", "argument", …] }`: the person who wrote the file chose what runs. */
export function parseResourcesCommand(text: string): string[] | null {
  try {
    const config: unknown = JSON.parse(text)
    const command = record(config) ? config.command : null
    return Array.isArray(command) && command.length > 0 && command.every(part => typeof part === 'string' && part.length > 0) ? command as string[] : null
  } catch { return null }
}

let orcaCli: string | null = null
/** null means the CLI did not answer: the caller must ask again later, not conclude "unknown terminal". */
async function terminalPaths(): Promise<Map<string, string> | null> {
  const answer = await orca(['terminal', 'list', '--json'])
  return answer === null ? null : parseTerminalPaths(answer)
}

let latest: Resources | null = null
let refreshedAt = 0
let refreshing = false
/** Never delays a read: answers with the last known value and refreshes behind it. */
async function resources(): Promise<Resources | null> {
  if (!refreshing && Date.now() - refreshedAt >= RESOURCES_TTL_MS) {
    refreshing = true
    void readFile(RESOURCES_CONFIG, 'utf8').then(parseResourcesCommand, () => null)
      .then(command => command ? runJson(command[0], command.slice(1)) : null)
      .then(answer => { latest = parseResources(answer) })
      .finally(() => { refreshedAt = Date.now(); refreshing = false })
  }
  return latest
}

/** Runs one CLI command with the candidate that answers; null when none does or when Orca answers with an error. */
async function orca(args: string[]): Promise<unknown> {
  const working = orcaCli
  for (const command of working ? [working, ...ORCA_CLI.filter(item => item !== working)] : ORCA_CLI) {
    const answer = await runJson(command, args)
    if (answer === null) continue
    orcaCli = command
    if (record(answer) && answer.ok === true) return answer
    report(command, `${args[0]} ${args[1]} refused`)
    return null
  }
  orcaCli = null
  return null
}

/** null means the read failed: the caller keeps what it had instead of showing "nothing". */
async function readRuns(): Promise<RunView[] | null> {
  const [terminalsAnswer, runsAnswer] = await Promise.all([
    orca(['terminal', 'list', '--json']),
    orca(['orchestration', 'run-list', '--limit', String(RUNS_SCANNED), '--json', '--full'])
  ])
  if (terminalsAnswer === null || runsAnswer === null) return null
  const terminals = parseTerminals(terminalsAnswer)
  const live = parseRuns(runsAnswer).filter(run => terminals.some(terminal => terminal.handle === run.coordinator)).slice(0, RUNS_READ)
  const views = await Promise.all(live.map(async run => {
    const [tasks, workers] = await Promise.all([
      orca(['orchestration', 'task-list', '--run', run.id, '--json']),
      orca(['orchestration', 'worker-list', '--run', run.id, '--limit', '100', '--json', '--full'])
    ])
    // Without its tasks a run cannot be counted; without its workers it still can.
    return tasks === null ? null : runView(run, parseTasks(tasks), parseWorkers(workers), terminals)
  }))
  return views.filter((view): view is RunView => view !== null)
}
let latestRuns: RunView[] = []
let runsAt = 0
let runsGoodAt = 0
let readingRuns = false
/** Same contract as resources: the last known runs now, a fresh read behind. */
async function orchestrations(): Promise<RunView[]> {
  if (!readingRuns && Date.now() - runsAt >= RUNS_TTL_MS) {
    readingRuns = true
    void readRuns().then(runs => { if (runs) { latestRuns = runs; runsGoodAt = Date.now() } }).catch(() => report('orca', 'orchestration read failed'))
      .finally(() => { runsAt = Date.now(); readingRuns = false })
  }
  return Date.now() - runsGoodAt > MAX_AGE_MS ? [] : latestRuns
}
let latestAutomations: AutomationView[] = []
let automationsAt = 0
let automationsGoodAt = 0
let readingAutomations = false
/** Schedules change rarely: the last known list now, a fresh read behind. */
async function automations(): Promise<AutomationView[]> {
  if (!readingAutomations && Date.now() - automationsAt >= AUTOMATIONS_TTL_MS) {
    readingAutomations = true
    void orca(['automations', 'list', '--json'])
      .then(answer => { if (answer !== null) { latestAutomations = parseAutomations(answer); automationsGoodAt = Date.now() } })
      .catch(() => report('orca', 'automations read failed'))
      .finally(() => { automationsAt = Date.now(); readingAutomations = false })
  }
  return Date.now() - automationsGoodAt > MAX_AGE_MS ? [] : latestAutomations
}
/** Asks Orca to show one terminal tab. The worker decides which handles may be asked for. */
async function focusTerminal(handle: string): Promise<boolean> {
  return (await orca(['terminal', 'switch', '--terminal', handle, '--json'])) !== null
}

/** Replaceable in tests, so a test never reads this machine. */
export const external = { terminalPaths, resources, orchestrations, automations, focusTerminal }
