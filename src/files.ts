import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Reason } from './model'

/** Do not follow symlinks, including ancestors. The state folder of one agent toolkit is never inspected. */
export function allowedPath(root: string, path: string): boolean {
  const parts = path.split('/')
  return isAbsolute(root) && path.length > 0 && !isAbsolute(path) && !path.includes('\\')
    && !path.includes('\0') && !/^[A-Za-z]:/.test(path)
    && parts.every((part) => part !== '..' && part !== '.' && part !== '')
    && !join(root, path).split(sep).join('/').includes('/.grok/skills/director/state/')
    && !join(root, path).split(sep).join('/').endsWith('/.grok/skills/director/state')
}
export function failure(reason: Reason): Error & { reason: Reason } {
  return Object.assign(new Error(reason), { reason })
}
export function reasonOf(error: unknown): Reason {
  const item = error as { code?: string; reason?: Reason }
  if (item.reason) return item.reason
  if (item.code === 'EACCES' || item.code === 'EPERM') return 'permission'
  if (item.code === 'ENOENT') return 'missing'
  if (item.code === 'ELOOP') return 'unsafePath'
  return 'read'
}
export async function safeRoot(root: string): Promise<string> {
  const path = resolve(root)
  if (!isAbsolute(root) || path.includes('/.grok/skills/director/state') || await realpath(path) !== path
    || !(await lstat(path)).isDirectory()) throw failure('unsafePath')
  return path
}
export async function safeStat(root: string, path: string) {
  if (!allowedPath(root, path)) throw failure('unsafePath')
  await safeRoot(root)
  let current = root
  let info
  for (const part of path.split('/')) {
    current = join(current, part)
    info = await lstat(current)
    if (info.isSymbolicLink()) throw failure('unsafePath')
  }
  const actual = await realpath(current)
  const within = relative(root, actual)
  if (actual !== current || within.startsWith(`..${sep}`) || isAbsolute(within)) throw failure('unsafePath')
  return info!
}
export async function readText(root: string, path: string): Promise<string> {
  if (!(await safeStat(root, path)).isFile()) throw failure('unsafePath')
  const handle = await open(join(root, path), constants.O_RDONLY | constants.O_NOFOLLOW)
  try {
    if (!(await handle.stat()).isFile()) throw failure('unsafePath')
    await safeStat(root, path)
    return await handle.readFile('utf8')
  } finally { await handle.close() }
}
