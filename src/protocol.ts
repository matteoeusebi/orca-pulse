import type { Snapshot } from './model'
declare module 'orca' {
  interface PluginRequests {
    'plans.read': { input: undefined; output: Snapshot }
    'plans.focus': { input: { terminal: string }; output: { ok: boolean } }
  }
}
