import { error } from './util'
import type { MiniProgram } from './mini-program'
import type { Element } from './element'
import type { PageIdentity, WaitOptions } from './types'

export class Page {
  miniProgram: MiniProgram
  path: string
  query: Record<string, unknown>
  constructor(
    miniProgram: MiniProgram,
    route: string,
    query: Record<string, unknown> = {},
    public identity?: PageIdentity,
  ) {
    this.miniProgram = miniProgram
    this.path = route
    this.query = query
  }
  private async _active(): Promise<PageIdentity> {
    const current = await this.miniProgram.currentPage()
    if (!current?.identity) throw error('ERR_RUNTIME_NOT_READY', 'Mini-program page is not ready')
    if (
      current.path !== this.path ||
      (this.identity &&
        (current.identity.id !== this.identity.id ||
          current.identity.documentId !== this.identity.documentId))
    )
      throw error('ERR_INACTIVE_PAGE', `Page is no longer current: ${this.path}`)
    this.identity ||= current.identity
    return this.identity
  }
  async $(selector: string): Promise<Element | null> {
    return (await this.miniProgram._queryPage(selector, false, await this._active()))[0] || null
  }
  async $$(selector: string): Promise<Element[]> {
    return this.miniProgram._queryPage(selector, true, await this._active())
  }
  waitFor(selector: string, options: WaitOptions | number = {}): Promise<Element> {
    if (typeof options === 'number') options = { timeout: options }
    return this.miniProgram.waitFor(
      async () => {
        try {
          const element = await this.$(selector)
          if (!element) return null
          await element.waitForStable(options)
          return element
        } catch (cause) {
          if (
            cause instanceof Error &&
            'code' in cause &&
            ['ERR_STALE_ELEMENT', 'ERR_RUNTIME_NOT_READY'].includes(String(cause.code))
          )
            return null
          throw cause
        }
      },
      { message: `Element not found: ${selector}`, ...options },
    )
  }
}
