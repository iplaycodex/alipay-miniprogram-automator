import { error } from './util'
import type { MiniProgram } from './mini-program'
import type { Element } from './element'
import type { WaitOptions } from './types'

export class Page {
  miniProgram: MiniProgram
  path: string
  query: Record<string, unknown>
  constructor(miniProgram: MiniProgram, route: string, query: Record<string, unknown> = {}) {
    this.miniProgram = miniProgram
    this.path = route
    this.query = query
  }
  private async _active(): Promise<void> {
    if ((await this.miniProgram.currentPage())?.path !== this.path)
      throw error('ERR_INACTIVE_PAGE', `Page is no longer current: ${this.path}`)
  }
  async $(selector: string): Promise<Element | null> {
    await this._active()
    return this.miniProgram.query(selector)
  }
  async $$(selector: string): Promise<Element[]> {
    await this._active()
    return this.miniProgram.queryAll(selector)
  }
  waitFor(selector: string, options: WaitOptions | number = {}): Promise<Element> {
    if (typeof options === 'number') options = { timeout: options }
    return this.miniProgram.waitFor(
      async () => {
        const element = await this.$(selector)
        if (!element) return null
        try {
          await element.waitForStable(options)
          return element
        } catch (cause) {
          if (cause instanceof Error && 'code' in cause && cause.code === 'ERR_STALE_ELEMENT')
            return null
          throw cause
        }
      },
      { message: `Element not found: ${selector}`, ...options },
    )
  }
}
