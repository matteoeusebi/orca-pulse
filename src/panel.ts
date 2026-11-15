// No build step: Orca strips the types and generates the HTML frame when the panel loads.
import type {} from 'orca/frame'
import type {} from './protocol'
import { styles } from './panel-style'
import { PanelState, phaseKey } from './panel-state'
import { renderPanel } from './panel-render'
import { connectPanel } from './panel-session'

const style = document.createElement('style')
style.textContent = styles
const root = document.createElement('main')
document.head.append(style)
document.body.append(root)
const state = new PanelState()
let previous = ''
function draw(): void {
  document.documentElement.lang = orca.locale
  const html = renderPanel(state, orca.locale)
  if (html === previous) return
  const focused = document.activeElement as HTMLElement | null
  const phase = focused?.dataset.phase
  const plan = focused?.dataset.plan
  const agents = focused?.dataset.agents
  const toggle = focused?.dataset.toggle
  const jumpTo = focused?.dataset.focus
  root.innerHTML = html
  previous = html
  // Polling must not steal keyboard focus or move the scroll position.
  if (phase || plan || agents || toggle || jumpTo) {
    const target = [...root.querySelectorAll<HTMLElement>('button')].find(button =>
      toggle ? button.dataset.toggle === toggle : jumpTo ? button.dataset.focus === jumpTo : agents ? button.dataset.agents === agents : phase ? button.dataset.phase === phase : button.dataset.plan === plan)
    ;(target ?? root.querySelector<HTMLElement>('button'))?.focus({ preventScroll: true })
  }
}
root.addEventListener('click', event => {
  const button = (event.target as Element).closest<HTMLButtonElement>('button')
  if (!button) return
  if (button.dataset.plan) state.selectPlan(button.dataset.plan)
  if (button.dataset.agents) state.toggleAgents(button.dataset.agents)
  if (button.dataset.toggle) state.toggle(button.dataset.toggle, button.dataset.default === 'true')
  // The jump is Orca's own tab switch; a refusal leaves the panel as it was.
  if (button.dataset.focus) void orca.plugin.request('plans.focus', { terminal: button.dataset.focus }).catch(() => undefined)
  if (button.dataset.phase) {
    const plan = state.currentPlan
    if (plan?.kind === 'plan') {
      const phase = plan.phases.find(phase => phaseKey(plan, phase) === button.dataset.phase)
      if (phase) state.togglePhase(plan, phase)
    }
  }
  draw()
})
draw()
const session = connectPanel({
  plugin: { request: (name, input, options) => orca.plugin.request(name, input, options) },
  on: (event, handler) => orca.on(event, handler)
}, draw, state)
const theme = orca.on('theme', draw)
window.addEventListener('pagehide', () => { session.dispose(); theme.dispose() }, { once: true })
