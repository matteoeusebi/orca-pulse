import { selectWorkspace, type Context, type TerminalWorkspaces, type Workspace, type WorkspaceList } from './workspace'

/** A terminal's folder proves its workspace without waiting for an agent event; a conflict proves nothing. */
function byFolder(context: NonNullable<Context>, list: WorkspaceList, paths: ReadonlyMap<string, string>): Workspace | null {
  let found: Workspace | null = null
  for (const terminal of context.terminals) {
    const path = paths.get(terminal.id)
    if (path === undefined) continue
    const matches = list.workspaces.filter(area => area.path === path)
    if (matches.length !== 1 || (found && found.id !== matches[0].id)) return null
    found = matches[0]
  }
  return found
}

/** Membership is sticky across overlapping contexts; name fallback remains replaceable by proof. */
export class FocusedWorkspace {
  private previous: { id: string; terminals: string[]; source: 'membership' | 'name' } | null = null
  resolve(context: Context, list: WorkspaceList, terminals: TerminalWorkspaces, paths: ReadonlyMap<string, string> = new Map()): Workspace | null {
    const located = context && !list.truncated ? byFolder(context, list, paths) : null
    if (located) {
      this.previous = { id: located.id, terminals: context!.terminals.map(terminal => terminal.id), source: 'membership' }
      return located
    }
    const previous = this.previous
    const overlaps = !!context && !!previous && context.terminals.some(terminal => previous.terminals.includes(terminal.id))
    let active: Workspace | null = null
    let source: 'membership' | 'name' = 'name'
    if (overlaps && previous?.source === 'membership') {
      active = list.workspaces.find(area => area.id === previous.id) ?? null
      source = 'membership'
    } else if (context && !list.truncated) {
      const member = terminals.workspaceFor(context.terminals, list.workspaces)
      if (member) { active = member; source = 'membership' }
      else if (member !== false) active = selectWorkspace(context, list)
        ?? (overlaps ? list.workspaces.find(area => area.id === previous?.id) ?? null : null)
    }
    this.previous = active && context ? { id: active.id, terminals: context.terminals.map(terminal => terminal.id), source } : null
    return active
  }
}
