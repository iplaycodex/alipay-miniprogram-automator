const { error } = require('./util')

class Page {
  constructor(miniProgram, route, query = {}) {
    this.miniProgram = miniProgram
    this.path = route
    this.query = query
  }
  async _active() {
    if ((await this.miniProgram.currentPage())?.path !== this.path)
      throw error('ERR_INACTIVE_PAGE', `Page is no longer current: ${this.path}`)
  }
  async $(selector) {
    await this._active()
    return this.miniProgram.query(selector)
  }
  async $$(selector) {
    await this._active()
    return this.miniProgram.queryAll(selector)
  }
  waitFor(selector, options = {}) {
    if (typeof options === 'number') options = { timeout: options }
    return this.miniProgram.waitFor(
      async () => {
        const element = await this.$(selector)
        if (!element) return null
        try {
          await element.waitForStable(options)
          return element
        } catch (cause) {
          if (cause.code === 'ERR_STALE_ELEMENT') return null
          throw cause
        }
      },
      { message: `Element not found: ${selector}`, ...options },
    )
  }
}

module.exports = { Page }
