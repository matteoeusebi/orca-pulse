export const styles = `
:root { color-scheme: light; --done: #2a9155; --waiting: #9a6a0c; }
html.dark { color-scheme: dark; --done: #6dc08a; --waiting: #e3b25a; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--orca-background); color: var(--orca-foreground); font: 12px/1.4 "Geist", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; text-align: left; cursor: pointer; }
button:focus-visible { outline: 2px solid var(--orca-ring); outline-offset: -2px; border-radius: 5px; }
button.row:hover, button.overview:hover { background: var(--orca-accent); }
header { padding: 12px 14px 6px; display: flex; align-items: baseline; gap: 7px; }
header h1 { margin: 0; color: var(--orca-foreground); font-size: 13px; font-weight: 600; overflow-wrap: anywhere; }
.count, .percent { color: var(--orca-muted-foreground); font-size: 11px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.percent { margin-left: auto; }
.list { padding: 4px 4px 8px; }
.row { display: flex; align-items: flex-start; gap: 8px; width: 100%; min-height: 26px; padding: 4px 10px; border-radius: 5px; }
.icon { flex: 0 0 16px; height: 16px; margin-top: .5px; display: grid; place-items: center; }
.name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.phase { font-weight: 500; }
.done { color: var(--orca-muted-foreground); font-weight: 400; }
.phase .count { font-weight: 400; }
.chevron { flex-shrink: 0; margin-top: 3.5px; color: var(--orca-muted-foreground); transition: transform .15s; }
[aria-expanded="true"] > .chevron { transform: rotate(90deg); }
.step { padding-left: 26px; color: color-mix(in srgb, var(--orca-foreground) 60%, var(--orca-muted-foreground)); }
.step.done { color: var(--orca-muted-foreground); }
.step.current, .step.waiting { color: var(--orca-foreground); }
.verify { font-size: 11px; color: var(--orca-muted-foreground); flex-shrink: 0; margin-top: 1px; }
.future-note { display: block; font-size: 11px; color: var(--orca-muted-foreground); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--orca-foreground); }
.amber { background: var(--waiting); }
.waiting-mark { flex: 0 0 8px; display: grid; place-items: center; height: 16px; }
.waiting-mark .dot { width: 6px; height: 6px; }
.spinner { width: 11px; height: 11px; border-radius: 50%; border: 1.6px solid var(--orca-border); border-top-color: var(--orca-foreground); animation: rotate .9s linear infinite; }
@keyframes rotate { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinner { animation: none; } .chevron { transition: none; } }
.others { border-top: 1px solid var(--orca-border); padding: 6px 4px; }
.caption, .message { margin: 0; padding: 4px 14px; font-size: 11px; font-weight: 400; color: var(--orca-muted-foreground); overflow-wrap: anywhere; }
.caption { padding: 4px 10px 2px; font-weight: 500; }
.overviews { padding: 4px 8px 12px; display: grid; gap: 6px; }
.overview { width: 100%; padding: 6px 9px; border: 1px solid var(--orca-border); border-radius: 6px; }
.overview .row { padding: 0; min-height: 20px; }
.next-step { display: flex; gap: 10px; font-size: 11px; padding-top: 7px; }
.plan { align-items: center; }
.resources { display: flex; align-items: baseline; gap: 8px; margin-top: 8px; padding: 8px 14px; border-top: 1px solid var(--orca-border); font-size: 11px; color: var(--orca-muted-foreground); }
.resources.red .name { color: var(--orca-foreground); }
.resources .count { margin-left: auto; }
.step.here { font-weight: 500; }
.runs { padding-bottom: 4px; }
.run .name, .task .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task { padding-left: 26px; align-items: center; color: var(--orca-foreground); }
.task.t-ok, .task.t-wait { color: var(--orca-muted-foreground); }
.word { flex-shrink: 0; font-size: 11px; }
.who { flex-shrink: 0; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11px; }
.jump { flex-shrink: 0; color: var(--orca-muted-foreground); }
.flag { flex: 0 0 12px; height: 16px; display: grid; place-items: center; }
.chat { align-items: center; }
.chat .name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.chat.idle { color: var(--orca-muted-foreground); }
.col { flex-shrink: 0; font-size: 11px; color: var(--orca-muted-foreground); text-align: right; font-variant-numeric: tabular-nums; }
.col.state { min-width: 62px; }
.col.time { min-width: 44px; }
.dot.hollow { width: 6px; height: 6px; background: none; border: 1.2px solid var(--orca-muted-foreground); }
.col.next { min-width: 84px; }
.col.strong { color: var(--orca-foreground); }
.dash { width: 8px; height: 1.4px; border-radius: 1px; background: var(--orca-muted-foreground); }
.flag svg { width: 12px; height: 12px; }
.agent { padding-left: 50px; min-height: 22px; font-size: 11px; color: var(--orca-muted-foreground); }
.agent-state { margin-left: 6px; opacity: .8; }
.loose { margin-top: 4px; color: var(--orca-muted-foreground); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
`
