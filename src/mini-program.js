const fs = require('node:fs')
const path = require('node:path')
const { Inspector } = require('./inspector')
const { waitFor, error, normalizePath } = require('./util')
const { Page } = require('./page')
const { Element } = require('./element')
const { assertSupportedVersion } = require('./ide-version')

class MiniProgram {
  static async connect(options = {}) {
    const inspector = await Inspector.connect(options)
    try {
      const info = await inspector.evaluate(`(() => {
        const electron = process.mainModule.require('electron')
        return {
          ideVersion: electron.app.getVersion(), platform: process.platform, pid: process.pid,
          profilePath: electron.app.getPath('userData'),
          simulators: electron.webContents.getAllWebContents()
            .filter(w => w.getURL().includes('/@ali/lyra-integration-ide/dist/ide/index.html'))
            .map(w => ({ id: w.id, title: w.getTitle() }))
        }
      })()`)
      if (
        options.profilePath &&
        normalizePath(info.profilePath) !== normalizePath(options.profilePath)
      ) {
        throw error('ERR_IDE_PROFILE', 'Connected IDE uses a different profilePath')
      }
      if (options.idePid && info.pid !== options.idePid)
        throw error('ERR_IDE_PROCESS', 'Inspector belongs to a different IDE process')
      assertSupportedVersion(info.ideVersion, options.allowUnverifiedVersion)
      const selected =
        options.simulatorId === undefined
          ? info.simulators.length === 1
            ? info.simulators[0]
            : null
          : info.simulators.find((simulator) => simulator.id === options.simulatorId)
      if (!selected)
        throw error(
          'ERR_SIMULATOR_TARGET',
          `Found ${info.simulators.length} simulator targets. Open a project first, or select simulatorId when multiple are open.`,
        )
      const miniProgram = new MiniProgram(inspector, selected.id, info, options)
      const supported = await miniProgram.renderer(
        `typeof window.__LYRA_GLOBAL_RUNTIME_API__?.evaluateJavaScriptInWorker === 'function'`,
      )
      if (!supported)
        throw error(
          'ERR_UNSUPPORTED_IDE',
          'This simulator does not expose the expected IDE worker API',
        )
      return miniProgram
    } catch (cause) {
      inspector.close()
      throw cause
    }
  }

  constructor(inspector, targetId, info, options = {}) {
    this.inspector = inspector
    this.targetId = targetId
    this.info = info
    this.timeout = options.timeout || 15000
    this.interval = options.interval || 100
    this._owned = null
  }

  async renderer(expression) {
    const wrapped = `Promise.resolve().then(() => (${expression})).then(value => ({ok:true,value}), cause => ({ok:false,message:String(cause?.message || cause),code:cause?.code}))`
    const result = await this.inspector.evaluate(`(() => {
      const target = process.mainModule.require('electron').webContents.fromId(${this.targetId})
      if (!target || target.isDestroyed()) throw new Error('Simulator target has closed')
      return target.executeJavaScript(${JSON.stringify(wrapped)})
    })()`)
    if (!result?.ok)
      throw error(result?.code || 'ERR_RENDERER', result?.message || 'Simulator execution failed')
    return result.value
  }

  /** Execute a JSON-serializable function or expression in the actual IDE mini-program worker. */
  evaluate(fn, ...args) {
    if (typeof fn !== 'function' && typeof fn !== 'string')
      throw error('ERR_OPTIONS', 'evaluate expects a function or expression string')
    const expression =
      typeof fn === 'string' ? fn : `(${fn.toString()})(...${JSON.stringify(args)})`
    return this.renderer(
      `window.__LYRA_GLOBAL_RUNTIME_API__.evaluateJavaScriptInWorker(${JSON.stringify(expression)})`,
    )
  }

  async pageStack() {
    const pages = await this.evaluate(() =>
      getCurrentPages().map((page) => ({
        path: page.route || page.__route__,
        query: page.options || {},
      })),
    )
    return pages.map((page) => new Page(this, page.path, page.query))
  }

  async currentPage() {
    const pages = await this.pageStack()
    return pages[pages.length - 1] || null
  }

  async _changeRoute(method, url) {
    if (typeof url !== 'string' || !url)
      throw error('ERR_OPTIONS', 'A mini-program route is required')
    await this.evaluate(
      (name, value) => {
        my[name]({ url: value })
        return true
      },
      method,
      url,
    )
    const expected = url.replace(/^\//, '').split('?')[0]
    return this.waitFor(async () => {
      const page = await this.currentPage()
      return page?.path === expected ? page : null
    }, `Page did not open: ${expected}`)
  }

  reLaunch(url) {
    return this._changeRoute('reLaunch', url)
  }
  navigateTo(url) {
    return this._changeRoute('navigateTo', url)
  }

  async navigateBack() {
    const pages = await this.pageStack()
    if (pages.length < 2) throw error('ERR_NAVIGATION', 'There is no previous page')
    const expected = pages[pages.length - 2].path
    await this.evaluate(() => {
      my.navigateBack()
      return true
    })
    return this.waitFor(async () => {
      const page = await this.currentPage()
      return page?.path === expected ? page : null
    }, `navigateBack did not return to ${expected}`)
  }

  waitFor(check, options = {}, timeout) {
    if (typeof options === 'string') options = { message: options, timeout }
    return waitFor(check, { timeout: this.timeout, interval: this.interval, ...options })
  }

  async _query(selector, text, all) {
    if (typeof selector !== 'string' || !selector)
      throw error('ERR_OPTIONS', 'A CSS selector is required')
    const matches = await this.renderer(`(() => {
      const store = window.__alipayAutomatorElements || (window.__alipayAutomatorElements = { sequence: 0, nodes: new Map(), ids: new WeakMap() })
      for (const [id, node] of store.nodes) {
        if (!node.isConnected || !node.ownerDocument.defaultView) store.nodes.delete(id)
      }
      const found = [], visited = new Set()
      function find(doc) {
        if (!doc?.defaultView || visited.has(doc)) return
        visited.add(doc)
        for (const node of doc.querySelectorAll(${JSON.stringify(selector)})) {
          if (${JSON.stringify(text)} !== undefined && !node.textContent.includes(${JSON.stringify(text)})) continue
          const rect = node.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          let id = store.ids.get(node)
          if (!id || !store.nodes.has(id)) { id = ++store.sequence; store.ids.set(node, id); store.nodes.set(id, node) }
          found.push(id)
        }
        for (const frame of doc.querySelectorAll('iframe')) { try { find(frame.contentDocument) } catch (_) {} }
      }
      find(document)
      return ${all ? 'found' : 'found.slice(0, 1)'}
    })()`)
    return matches.map((id) => new Element(this, id, selector))
  }

  async query(selector, text) {
    return (await this._query(selector, text, false))[0] || null
  }
  queryAll(selector, text) {
    return this._query(selector, text, true)
  }

  async _inputCommand(method, params) {
    return this.inspector.evaluate(`(async () => {
      const target = process.mainModule.require('electron').webContents.fromId(${this.targetId})
      if (!target || target.isDestroyed()) throw new Error('Simulator target has closed')
      if (!target.debugger.isAttached()) target.debugger.attach('1.3')
      await target.debugger.sendCommand(${JSON.stringify(method)}, ${JSON.stringify(params)})
      return true
    })()`)
  }

  async mouseClick(x, y) {
    if (![x, y].every(Number.isFinite))
      throw error('ERR_OPTIONS', 'Pointer coordinates must be finite')
    await this._inputCommand('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
    await this._inputCommand('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      buttons: 1,
      clickCount: 1,
    })
    await this._inputCommand('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      buttons: 0,
      clickCount: 1,
    })
  }

  insertText(text) {
    return this._inputCommand('Input.insertText', { text: String(text) })
  }

  async pressKey({ key, code, keyCode, modifiers = 0, commands }) {
    const params = { key, code, windowsVirtualKeyCode: keyCode, modifiers }
    if (commands) params.commands = commands
    await this._inputCommand('Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' })
    await this._inputCommand('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
  }

  async screenshot({ path: destination } = {}) {
    const data = await this.inspector
      .evaluate(`process.mainModule.require('electron').webContents.fromId(${this.targetId})
      .capturePage().then(image => image.toPNG().toString('base64'))`)
    const buffer = Buffer.from(data, 'base64')
    if (destination) {
      fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true })
      fs.writeFileSync(destination, buffer)
    }
    return buffer
  }

  disconnect() {
    this.inspector.close()
  }

  async close() {
    if (!this._owned) {
      this.disconnect()
      return
    }
    const owned = this._owned
    this._owned = null
    try {
      await this.inspector.evaluate(`(() => {
        const app = process.mainModule.require('electron').app
        if (process.pid !== ${owned.child.pid} || app.getPath('userData') !== ${JSON.stringify(owned.profilePath)}) throw new Error('Refusing to close another IDE')
        setTimeout(() => app.quit(), 100)
        return true
      })()`)
    } finally {
      this.disconnect()
      try {
        await waitFor(() => owned.child.exitCode !== null || owned.child.signalCode !== null, {
          timeout: 8000,
          message: 'IDE did not exit',
        })
      } catch (_) {
        owned.child.kill('SIGTERM')
      }
    }
  }
}

module.exports = { MiniProgram }
