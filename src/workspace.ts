import { lstat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { readText, reasonOf, safeRoot } from './files'

export type Workspace = { id: string; name: string; project?: string | null; path: string; branch: string | null; hostId: string | null }
export type Context = { displayName: string; branch: string; terminals: { id: string }[] } | null
export type WorkspaceList = { workspaces: Workspace[]; truncated: boolean }

/** Only the standard .git/worktrees/<name> layout proves a main checkout. */
export async function projectRoot(path: string): Promise<string | null> {
  try {
    const root = await safeRoot(path)
    let info
    try { info = await lstat(join(root, '.git')) }
    catch (error) { if (reasonOf(error) === 'missing') return root; throw error }
    if (info.isDirectory()) return root
    if (!info.isFile()) return null
    const match = /^gitdir:\s*(.+?)\s*$/.exec(await readText(root, '.git'))
    if (!match) return null
    const gitdir = resolve(root, match[1])
    if (basename(dirname(gitdir)) !== 'worktrees' || basename(dirname(dirname(gitdir))) !== '.git') return null
    await safeRoot(gitdir)
    return await safeRoot(dirname(dirname(dirname(gitdir))))
  } catch { return null }
}

/** In-memory only; evict the pane least recently reported when this limit is reached. */
const MAX_TERMINAL_WORKSPACES = 2048
/** Status changes are not heartbeats; allow quiet work for thirty minutes before expiring indicators. */
export const NON_FOCUSED_ACTIVITY_TTL_MS = 1800000
export function matchesWorkspace(workspaceId: string | null | undefined, area: { id: string; path: string }): boolean {
  return workspaceId === area.id || (workspaceId?.endsWith(`::${area.path}`) ?? false)
}
export class TerminalWorkspaces {
  private readonly areas = new Map<string, { terminalId?: string; workspaceId: string; state?: string; title?: string; receivedAt: number }>()
  record({ paneKey, terminalId, workspaceId, state, title, receivedAt = Date.now() }: { paneKey: string; terminalId?: string; workspaceId: string | null; state?: string; title?: string; receivedAt?: number }): void {
    this.areas.delete(paneKey)
    if (!workspaceId) return
    this.areas.set(paneKey, { terminalId, workspaceId, state, title,
      receivedAt: Number.isFinite(receivedAt) ? Math.min(receivedAt, Date.now()) : Date.now() })
    if (this.areas.size > MAX_TERMINAL_WORKSPACES) this.areas.delete(this.areas.keys().next().value!)
  }
  removeWorkspace({ workspaceId, path }: { workspaceId: string; path: string }): void {
    for (const [paneKey, area] of this.areas) {
      if (matchesWorkspace(area.workspaceId, { id: workspaceId, path })) this.areas.delete(paneKey)
    }
  }
  /** Join only terminals in the focused context; status and terminal titles are irrelevant. */
  workspaceFor(terminals: readonly { id: string }[], workspaces: readonly Workspace[]): Workspace | null | false {
    const ids = new Set(terminals.map(terminal => terminal.id))
    let identified: Workspace | null = null
    for (const event of this.areas.values()) {
      if (!event.terminalId || !ids.has(event.terminalId)) continue
      const matches = workspaces.filter(area => matchesWorkspace(event.workspaceId, area))
      if (matches.length !== 1 || (identified && identified.id !== matches[0].id)) return false
      identified = matches[0]
    }
    return identified
  }
  activity(workspaces: readonly Workspace[], focused: Workspace | null, now = Date.now()): { workspaceId: string; state?: string; title?: string; terminalId?: string; receivedAt?: number }[] {
    for (const [paneKey, event] of this.areas) {
      const matches = workspaces.filter(area => matchesWorkspace(event.workspaceId, area))
      const isFocused = matches.length === 1 && matches[0].id === focused?.id
      const expirable = ['working', 'waiting', 'blocked'].includes(event.state ?? '')
      if (matches.length !== 1 || (!isFocused && expirable && now - event.receivedAt >= NON_FOCUSED_ACTIVITY_TTL_MS)) {
        // Identity survives status expiry; a later focused context can still prove membership.
        this.areas.set(paneKey, { ...event, state: undefined })
      }
    }
    return [...this.areas.values()].map(({ workspaceId, state, title, terminalId, receivedAt }) => ({ workspaceId, state, title, terminalId, receivedAt }))
  }
}

/** Name/project and branch are a fallback when terminal membership has not identified focus. */
export function selectWorkspace(context: Context, list: WorkspaceList): Workspace | null {
  if (!context || list.truncated) return null
  const matches = list.workspaces.filter((area) => (area.name === context.displayName || area.project === context.displayName)
    && (area.branch ?? '') === context.branch)
  return matches.length === 1 ? matches[0] : null
}
