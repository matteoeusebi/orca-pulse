import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { external } from '../src/external'

// Tests never read this machine: no Orca CLI, no resource provider.
external.terminalPaths = async () => new Map<string, string>()
external.resources = async () => null
external.orchestrations = async () => []
external.automations = async () => []
external.focusTerminal = async () => false

export const work = fileURLToPath(new URL('../.work/', import.meta.url))
export async function fixture() {
  await mkdir(work, { recursive: true })
  const root = await mkdtemp(join(work, 'test-'))
  return {
    root,
    async write(path: string, content: unknown = '') {
      const file = join(root, path)
      await mkdir(join(file, '..'), { recursive: true })
      await writeFile(file, typeof content === 'string' ? content : JSON.stringify(content))
      return file
    },
    close: () => rm(root, { recursive: true, force: true })
  }
}
export function plan(steps: unknown[] = [{ id: 'first', title: 'Prima prova', doneWhen: { manual: true } }]) {
  return { schemaVersion: 1, id: 'sample', title: 'Alba', status: 'approved',
    phases: [{ id: 'engine', title: 'Motore', steps }] }
}
export function area(path: string, id = 'area-a', name = 'main') {
  return { id, kind: 'worktree' as const, name, project: null, path, branch: 'main', hostId: 'local' }
}
