// Deliberately small DOM double: parsing, selectors, bubbling and focus only; no browser layout.
const decode = (value: string): string => value.replace(/&(amp|lt|gt|quot|#39);/g,
  (_, name: string) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]!)
type Listener = (event: { target: FakeElement }) => unknown

export class FakeElement {
  readonly attributes = new Map<string, string>()
  readonly children: (FakeElement | string)[] = []
  readonly listeners = new Map<string, Listener[]>()
  parentElement: FakeElement | null = null
  lang = ''
  focusOptions: { preventScroll?: boolean } | undefined
  private markup = ''
  constructor(readonly tagName: string, readonly ownerDocument: FakeDocument) {}
  get dataset(): Record<string, string> {
    return Object.fromEntries([...this.attributes].filter(([name]) => name.startsWith('data-'))
      .map(([name, value]) => [name.slice(5).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()), value]))
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  get textContent(): string { return this.children.map(child => typeof child === 'string' ? child : child.textContent).join('') }
  set textContent(value: string) { this.children.splice(0, this.children.length, value) }
  get innerHTML(): string { return this.markup }
  set innerHTML(value: string) {
    if (this.ownerDocument.activeElement && this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = this.ownerDocument.body
    for (const child of this.children) if (typeof child !== 'string') child.parentElement = null
    this.children.length = 0
    this.markup = value
    const stack: FakeElement[] = [this]
    for (const token of value.match(/<[^>]*>|[^<]+/g) ?? []) {
      if (token.startsWith('</')) { stack.pop(); continue }
      if (!token.startsWith('<')) { stack.at(-1)!.children.push(decode(token)); continue }
      const tag = /^<([\w-]+)/.exec(token)?.[1]
      if (!tag) throw Error(`Unsupported HTML token: ${token}`)
      const element = new FakeElement(tag, this.ownerDocument)
      for (const match of token.slice(tag.length + 1, -1).matchAll(/([^\s=/>]+)(?:="([^"]*)")?/g)) {
        element.attributes.set(match[1], decode(match[2] ?? ''))
      }
      stack.at(-1)!.append(element)
      if (!token.endsWith('/>') && !['br', 'img', 'input', 'meta', 'link'].includes(tag)) stack.push(element)
    }
    if (stack.length !== 1) throw Error('Unbalanced HTML in fake document')
  }
  append(...elements: FakeElement[]): void {
    for (const element of elements) { element.parentElement = this; this.children.push(element) }
  }
  contains(element: FakeElement): boolean {
    return element === this || this.children.some(child => child instanceof FakeElement && child.contains(element))
  }
  matches(selector: string): boolean {
    const tag = /^[\w-]+/.exec(selector)?.[0]
    if (tag && tag !== this.tagName) return false
    for (const [, name] of selector.matchAll(/\.([\w-]+)/g)) if (!(this.getAttribute('class') ?? '').split(' ').includes(name)) return false
    for (const [, name, value] of selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
      if (!this.attributes.has(name) || (value !== undefined && this.getAttribute(name) !== value)) return false
    }
    if (!/^(?:[\w-]+)?(?:\.[\w-]+|\[[\w-]+(?:="[^"]*")?\])*$/.test(selector)) throw Error(`Unsupported selector: ${selector}`)
    return true
  }
  closest(selector: string): FakeElement | null { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null }
  querySelectorAll(selector: string): FakeElement[] {
    const descendants = this.children.flatMap(child => child instanceof FakeElement ? [child, ...child.querySelectorAll('*')] : [])
    if (selector === '*') return descendants
    const parts = selector.split(' ')
    return descendants.filter(element => {
      if (!element.matches(parts.at(-1)!)) return false
      let ancestor = element.parentElement
      for (let index = parts.length - 2; index >= 0; index--) {
        while (ancestor && !ancestor.matches(parts[index])) ancestor = ancestor.parentElement
        if (!ancestor) return false
        ancestor = ancestor.parentElement
      }
      return true
    })
  }
  querySelector(selector: string): FakeElement | null { return this.querySelectorAll(selector)[0] ?? null }
  addEventListener(name: string, handler: Listener): void { this.listeners.set(name, [...this.listeners.get(name) ?? [], handler]) }
  click(): void {
    for (let node: FakeElement | null = this; node; node = node.parentElement) {
      for (const handler of node.listeners.get('click') ?? []) handler({ target: this })
    }
  }
  focus(options?: { preventScroll?: boolean }): void { this.ownerDocument.activeElement = this; this.focusOptions = options }
}

export class FakeDocument {
  readonly documentElement = new FakeElement('html', this)
  readonly head = new FakeElement('head', this)
  readonly body = new FakeElement('body', this)
  activeElement: FakeElement | null = this.body
  constructor() { this.documentElement.append(this.head, this.body) }
  createElement(tag: string): FakeElement { return new FakeElement(tag, this) }
  querySelector(selector: string): FakeElement | null { return this.documentElement.querySelector(selector) }
}
