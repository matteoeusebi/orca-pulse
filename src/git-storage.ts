import { failure, readText, reasonOf, safeStat } from './files'

function configValue(raw: string): string {
  let value = '', quoted = false
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i]
    if (char === '"') quoted = !quoted
    else if (char === '\\') {
      const escaped = ({ n: '\n', t: '\t', b: '\b', '"': '"', '\\': '\\' } as Record<string, string>)[raw[++i]]
      if (escaped === undefined) throw failure('read')
      value += escaped
    } else if (!quoted && (char === '#' || char === ';')) break
    else value += char
  }
  if (quoted) throw failure('read')
  return value.trim()
}

/** Only inspect the local storage declaration; never follow includes or external backend paths. */
export async function unsupportedRefStorage(root: string): Promise<boolean> {
  try { if ((await safeStat(root, '.git/reftable')).isDirectory()) return true }
  catch (error) { if (reasonOf(error) !== 'missing') throw error }
  let config: string
  try { config = await readText(root, '.git/config') }
  catch (error) { if (reasonOf(error) === 'missing') return false; throw error }
  let section = ''
  for (let line of config.replace(/\\\r?\n/g, '').split(/\r?\n/)) {
    const header = /^\s*\[([^\]]+)\](.*)$/.exec(line)
    if (header) { section = header[1].trim().toLowerCase(); line = header[2] }
    const setting = /^\s*refstorage\s*=\s*(.*)$/i.exec(line)
    if (section === 'extensions' && setting && configValue(setting[1]) !== 'files') return true
  }
  return false
}
