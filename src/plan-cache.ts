import { failure, readText, safeStat } from './files'

/** Cache parsed plan contents only; evidence metadata is evaluated on every snapshot. */
export class PlanFileCache {
  private readonly entries = new Map<string, { signature: string; value: unknown }>()
  constructor(private readonly read = readText) {}
  async load(root: string, file: string): Promise<unknown> {
    const key = `${root}/${file}`
    try {
      const info = await safeStat(root, file)
      if (!info.isFile()) throw failure('unsafePath')
      const signature = JSON.stringify([info.mtimeMs, info.ctimeMs, info.size, info.dev, info.ino, info.mode, info.uid, info.gid])
      const cached = this.entries.get(key)
      if (cached?.signature === signature) return cached.value
      const text = await this.read(root, file)
      let value: unknown
      try { value = JSON.parse(text) } catch { throw failure('invalidJson') }
      this.entries.delete(key)
      this.entries.set(key, { signature, value })
      if (this.entries.size > 2048) this.entries.delete(this.entries.keys().next().value!)
      return value
    } catch (error) {
      this.entries.delete(key)
      throw error
    }
  }
}
