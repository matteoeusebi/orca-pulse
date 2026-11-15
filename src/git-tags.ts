import { allowedPath, readText, reasonOf, safeStat } from './files'
import type { StepState } from './model'
import { unsupportedRefStorage } from './git-storage'

const objectId = /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/
function validTag(root: string, tag: string): boolean {
  return allowedPath(root, tag) && !/[\x00-\x20\x7f~^:?*\[\\]/.test(tag)
    && !tag.includes('..') && !tag.includes('@{') && !tag.endsWith('.')
    && tag.split('/').every(part => !part.startsWith('.') && !part.endsWith('.lock'))
}

/** Loose and packed refs are read afresh, inside the existing safe filesystem boundary. */
export async function gitTagState(root: string, tag: string): Promise<StepState> {
  if (!validTag(root, tag)) return 'unknown'
  try {
    if (!(await safeStat(root, '.git')).isDirectory()) return 'unknown'
    if (await unsupportedRefStorage(root)) return 'unknown'
    try {
      const value = (await readText(root, `.git/refs/tags/${tag}`)).trim()
      return objectId.test(value) && !/^0+$/.test(value) ? 'done' : 'unknown'
    } catch (error) { if (reasonOf(error) !== 'missing') return 'unknown' }
    let packed: string
    try { packed = await readText(root, '.git/packed-refs') }
    catch (error) { return reasonOf(error) === 'missing' ? 'open' : 'unknown' }
    for (const line of packed.split(/\r?\n/)) {
      if (!line || line.startsWith('#') || line.startsWith('^')) continue
      const [hash, ref, extra] = line.split(' ')
      if (ref === `refs/tags/${tag}`) return !extra && objectId.test(hash) && !/^0+$/.test(hash) ? 'done' : 'unknown'
    }
    return 'open'
  } catch { return 'unknown' }
}
