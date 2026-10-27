class Element {
  constructor(miniProgram, id, selector) {
    this.miniProgram = miniProgram
    this.id = id
    this.selector = selector
  }
  inspect(fn) {
    return this.miniProgram.renderer(`(() => {
      const node = window.__alipayAutomatorElements?.nodes.get(${this.id})
      if (!node?.isConnected || !node.ownerDocument.defaultView) throw Object.assign(new Error('Element is no longer attached'), {code:'ERR_STALE_ELEMENT'})
      return (${fn.toString()})(node)
    })()`)
  }
  text() {
    return this.inspect((node) => node.innerText || node.textContent)
  }
  value() {
    return this.inspect((node) => node.value)
  }
  attribute(name) {
    return this.inspect(`node => node.getAttribute(${JSON.stringify(name)})`)
  }
  bounds() {
    return this.inspect((node) => {
      const rect = node.getBoundingClientRect()
      let x = rect.x,
        y = rect.y,
        width = rect.width,
        height = rect.height
      let frame = node.ownerDocument.defaultView.frameElement
      while (frame) {
        const bounds = frame.getBoundingClientRect()
        const sx = bounds.width / frame.offsetWidth,
          sy = bounds.height / frame.offsetHeight
        x = bounds.x + x * sx
        y = bounds.y + y * sy
        width *= sx
        height *= sy
        frame = frame.ownerDocument.defaultView.frameElement
      }
      return { x, y, width, height }
    })
  }
  waitForStable(options = {}) {
    if (typeof options === 'number') options = { timeout: options }
    let previous,
      stable = 0
    return this.miniProgram.waitFor(
      async () => {
        const bounds = await this.bounds()
        const signature = Object.values(bounds)
          .map((value) => Math.round(value * 10))
          .join(',')
        stable = signature === previous ? stable + 1 : 0
        previous = signature
        return stable >= 2 ? bounds : null
      },
      { message: `Element did not stop moving: ${this.selector}`, ...options },
    )
  }
  async tap(options = {}) {
    await this.waitForStable(options)
    const point = await this.miniProgram.waitFor(
      () =>
        this.inspect((node) => {
          if (node.matches(':disabled') || node.getAttribute('aria-disabled') === 'true')
            throw Object.assign(new Error('Element is disabled'), { code: 'ERR_ELEMENT_DISABLED' })
          const rect = node.getBoundingClientRect()
          let x = rect.x + rect.width / 2,
            y = rect.y + rect.height / 2
          let doc = node.ownerDocument
          let hit = doc.elementFromPoint(x, y)
          if (!hit || !(hit === node || node.contains(hit))) return null
          let frame = doc.defaultView.frameElement
          while (frame) {
            const bounds = frame.getBoundingClientRect()
            x = bounds.x + (x * bounds.width) / frame.offsetWidth
            y = bounds.y + (y * bounds.height) / frame.offsetHeight
            doc = frame.ownerDocument
            hit = doc.elementFromPoint(x, y)
            if (!hit || !(hit === frame || frame.contains(hit))) return null
            frame = doc.defaultView.frameElement
          }
          return { x, y }
        }),
      { message: `Element is obscured or outside the viewport: ${this.selector}`, ...options },
    )
    await this.miniProgram.mouseClick(point.x, point.y)
  }
  async input(text) {
    await this.tap()
    await this.miniProgram.insertText(text)
  }
  async fill(text) {
    await this.tap()
    await this.miniProgram.pressKey({
      key: 'a',
      code: 'KeyA',
      keyCode: 65,
      modifiers: this.miniProgram.info.platform === 'darwin' ? 4 : 2,
      commands: ['selectAll'],
    })
    if (String(text)) await this.miniProgram.insertText(text)
    else await this.miniProgram.pressKey({ key: 'Backspace', code: 'Backspace', keyCode: 8 })
  }
}

module.exports = { Element }
