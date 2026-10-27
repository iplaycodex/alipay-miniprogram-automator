import fs from 'node:fs'
import path from 'node:path'
import { Inspector } from './inspector'
import { waitFor, error, normalizePath } from './util'
import { Page } from './page'
import { Element } from './element'
import { assertSupportedVersion } from './ide-version'

import type {
  ConnectOptions,
  IDEInfo,
  InspectorConnection,
  KeyOptions,
  OwnedIDE,
  PageIdentity,
  RendererResponse,
  ScreenshotOptions,
  WaitOptions,
  WaitResult,
} from './types'

export class MiniProgram {
  inspector: InspectorConnection
  targetId: number
  info: IDEInfo
  timeout: number
  interval: number
  _owned: OwnedIDE | null
  static async connect(options: ConnectOptions = {}): Promise<MiniProgram> {
    const inspector = await Inspector.connect(options)
    try {
      const info = await inspector.evaluate<IDEInfo>(`(() => {
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

  constructor(
    inspector: InspectorConnection,
    targetId: number,
    info: IDEInfo,
    options: ConnectOptions = {},
  ) {
    this.inspector = inspector
    this.targetId = targetId
    this.info = info
    this.timeout = options.timeout || 15000
    this.interval = options.interval || 100
    this._owned = null
  }

  async renderer<T = unknown>(expression: string): Promise<T> {
    const wrapped = `Promise.resolve().then(() => (${expression})).then(value => ({ok:true,value}), cause => ({ok:false,message:String(cause?.message || cause),code:cause?.code}))`
    const result: RendererResponse<T> = await this.inspector.evaluate(`(() => {
      const target = process.mainModule.require('electron').webContents.fromId(${this.targetId})
      if (!target || target.isDestroyed()) throw new Error('Simulator target has closed')
      return target.executeJavaScript(${JSON.stringify(wrapped)})
    })()`)
    if (!result?.ok)
      throw error(result?.code || 'ERR_RENDERER', result?.message || 'Simulator execution failed')
    return result.value
  }

  /** Execute a JSON-serializable function or expression in the actual IDE mini-program worker. */
  evaluate<Args extends unknown[], Result>(
    fn: (...args: Args) => Result,
    ...args: Args
  ): Promise<Awaited<Result>>
  evaluate<Result = unknown>(expression: string, ...args: unknown[]): Promise<Result>
  evaluate(fn: string | ((...args: any[]) => unknown), ...args: unknown[]): Promise<unknown> {
    if (typeof fn !== 'function' && typeof fn !== 'string')
      throw error('ERR_OPTIONS', 'evaluate expects a function or expression string')
    const expression =
      typeof fn === 'string' ? fn : `(${fn.toString()})(...${JSON.stringify(args)})`
    return this.renderer(
      `window.__LYRA_GLOBAL_RUNTIME_API__.evaluateJavaScriptInWorker(${JSON.stringify(expression)})`,
    )
  }

  async pageStack(): Promise<Page[]> {
    const pages = await this.evaluate(() => {
      if (typeof getCurrentPages !== 'function') return null
      return getCurrentPages().map((page) => ({
        path: page.route || page.__route__,
        id: String(page.$id),
        viewId: String(page.$viewId),
        query: page.getLoadOptions(),
      }))
    })
    if (!Array.isArray(pages))
      throw error('ERR_RUNTIME_NOT_READY', 'Mini-program worker is not ready')
    const documents = await this.renderer<Record<string, string>>(`(() => {
      const store = window.__alipayAutomatorDocuments ||= { epoch: Date.now() + ':' + Math.random(), sequence: 0, ids: new WeakMap() }
      const found = {}
      for (const frame of document.querySelectorAll('iframe.tr-page-iframe')) {
        const doc = frame.contentDocument
        const viewId = frame.contentWindow?.__LyraViewId
        if (!doc?.body || doc.readyState !== 'complete' || viewId === undefined) continue
        if (!store.ids.has(doc)) store.ids.set(doc, store.epoch + ':' + ++store.sequence)
        found[String(viewId)] = store.ids.get(doc)
      }
      return found
    })()`)
    return pages.map((page) => {
      if (!page.path || !documents[page.viewId])
        throw error('ERR_RUNTIME_NOT_READY', 'Mini-program page renderer is not ready')
      return new Page(this, page.path, page.query, {
        id: page.id,
        viewId: page.viewId,
        documentId: documents[page.viewId],
      })
    })
  }

  async currentPage(): Promise<Page | null> {
    try {
      const pages = await this.pageStack()
      return pages[pages.length - 1] || null
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ERR_RUNTIME_NOT_READY')
        return null
      throw cause
    }
  }

  /** @internal Wait for matching worker/render documents and the IDE startup phase to settle. */
  async _waitForReady(timeout = this.timeout): Promise<Page[]> {
    let previous = '',
      stable = 0
    return this.waitFor(
      async () => {
        const pages = await this._readyPages()
        const signature = pages && JSON.stringify(pages.map((page) => page.identity))
        stable = signature && signature === previous ? stable + 1 : 0
        previous = signature || ''
        return pages && stable >= 2 ? pages : null
      },
      { timeout, message: 'Mini-program worker and renderer did not become ready' },
    )
  }

  private async _readyPages(): Promise<Page[] | null> {
    try {
      if (
        await this.renderer(
          "typeof window.__LYRA_GLOBAL_RUNTIME_API__?.evaluateJavaScriptInWorker !== 'function' || window.__LYRA_GLOBAL_RUNTIME_API__?.runtime?.isAppStarting === true",
        )
      )
        return null
      const pages = await this.pageStack()
      return pages.length ? pages : null
    } catch (cause) {
      if (cause instanceof Error && 'code' in cause && cause.code === 'ERR_RUNTIME_NOT_READY')
        return null
      throw cause
    }
  }

  private async _navigate(
    method: 'reLaunch' | 'navigateTo' | 'navigateBack',
    url?: string,
  ): Promise<Page> {
    const before = await this._waitForReady()
    if (method === 'navigateBack' && before.length < 2)
      throw error('ERR_NAVIGATION', 'There is no previous page')
    const result = await this.evaluate(
      (name, value) =>
        new Promise<{
          ok: boolean
          message?: string
          platformCode?: string | number
        }>((resolve) => {
          my[name]({
            ...(value === null ? {} : { url: value }),
            success: () => resolve({ ok: true }),
            fail: (cause) =>
              resolve({
                ok: false,
                message: cause.errorMessage || cause.errMsg || 'Native navigation failed',
                platformCode: cause.error,
              }),
          })
        }),
      method,
      url ?? null,
    )
    if (!result?.ok)
      throw Object.assign(
        error('ERR_NAVIGATION', result?.message || 'Native navigation did not succeed'),
        { platformCode: result?.platformCode },
      )
    const expectedPath = url?.replace(/^\//, '').split('?')[0]
    const expectedPrevious = before[before.length - 2]?.identity
    const oldIdentity = before[before.length - 1].identity
    return this.waitFor(async () => {
      const pages = await this._readyPages()
      if (!pages) return null
      const page = pages[pages.length - 1]
      const same = (left: PageIdentity | undefined, right: PageIdentity | undefined) =>
        left?.id === right?.id && left?.documentId === right?.documentId
      if (method === 'navigateBack')
        return pages.length === before.length - 1 && same(page.identity, expectedPrevious)
          ? page
          : null
      const expectedLength = method === 'reLaunch' ? 1 : before.length + 1
      return page.path === expectedPath &&
        pages.length === expectedLength &&
        !same(page.identity, oldIdentity)
        ? page
        : null
    }, `Native ${method} completed but the expected page instance did not become ready`)
  }

  reLaunch(url: string): Promise<Page> {
    if (typeof url !== 'string' || !url)
      return Promise.reject(error('ERR_OPTIONS', 'A mini-program route is required'))
    return this._navigate('reLaunch', url)
  }
  navigateTo(url: string): Promise<Page> {
    if (typeof url !== 'string' || !url)
      return Promise.reject(error('ERR_OPTIONS', 'A mini-program route is required'))
    return this._navigate('navigateTo', url)
  }
  navigateBack(): Promise<Page> {
    return this._navigate('navigateBack')
  }

  waitFor<T>(check: () => T, options?: WaitOptions): Promise<WaitResult<T>>
  waitFor<T>(check: () => T, message: string, timeout?: number): Promise<WaitResult<T>>
  waitFor<T>(
    check: () => T,
    options: WaitOptions | string = {},
    timeout?: number,
  ): Promise<WaitResult<T>> {
    if (typeof options === 'string') options = { message: options, timeout }
    return waitFor(check, { timeout: this.timeout, interval: this.interval, ...options })
  }

  private async _query(
    selector: string,
    text: string | undefined,
    all: boolean,
    page?: PageIdentity,
  ): Promise<Element[]> {
    if (typeof selector !== 'string' || !selector)
      throw error('ERR_OPTIONS', 'A CSS selector is required')
    const active = await this.currentPage()
    if (!active?.identity) throw error('ERR_RUNTIME_NOT_READY', 'There is no active page')
    if (page && (active.identity.id !== page.id || active.identity.documentId !== page.documentId))
      throw error('ERR_INACTIVE_PAGE', 'Page is no longer current')
    const identity = page || active.identity
    const matches = await this.renderer<number[]>(`(() => {
      const store = window.__alipayAutomatorElements || (window.__alipayAutomatorElements = { sequence: 0, nodes: new Map(), ids: new WeakMap() })
      for (const [id, node] of store.nodes) {
        if (!node.isConnected || !node.ownerDocument.defaultView) store.nodes.delete(id)
      }
      const identity = ${JSON.stringify(identity)}
      const pageOnly = ${!!page}
      const root = Array.from(document.querySelectorAll('iframe.tr-page-iframe')).find(frame =>
        String(frame.contentWindow?.__LyraViewId) === identity.viewId &&
        window.__alipayAutomatorDocuments?.ids.get(frame.contentDocument) === identity.documentId)
      if (!root?.contentDocument) throw Object.assign(new Error('Page document was replaced'), {code:'ERR_INACTIVE_PAGE'})
      const found = [], visited = new Set()
      function find(doc) {
        if (!doc?.defaultView || visited.has(doc)) return
        visited.add(doc)
        for (const node of doc.querySelectorAll(${JSON.stringify(selector)})) {
          if (${JSON.stringify(text)} !== undefined && !node.textContent.includes(${JSON.stringify(text)})) continue
          const container = node.closest('.tr-page')
          if (container) {
            const frame = container.querySelector('iframe.tr-page-iframe')
            if (frame && frame !== root) continue
          }
          const rect = node.getBoundingClientRect()
          if (rect.width <= 0 || rect.height <= 0) continue
          let id = store.ids.get(node)
          if (!id || !store.nodes.has(id)) { id = ++store.sequence; store.ids.set(node, id); store.nodes.set(id, node) }
          found.push(id)
        }
        for (const frame of doc.querySelectorAll('iframe')) {
          if (frame.matches('.tr-page-iframe') && frame !== root) continue
          try { find(frame.contentDocument) } catch (_) {}
        }
      }
      find(pageOnly ? root.contentDocument : document)
      return ${all ? 'found' : 'found.slice(0, 1)'}
    })()`)
    return matches.map((id) => new Element(this, id, selector))
  }

  /** @internal Query only the specified current page's renderer document. */
  _queryPage(selector: string, all: boolean, identity: PageIdentity): Promise<Element[]> {
    return this._query(selector, undefined, all, identity)
  }

  async query(selector: string, text?: string): Promise<Element | null> {
    return (await this._query(selector, text, false))[0] || null
  }
  queryAll(selector: string, text?: string): Promise<Element[]> {
    return this._query(selector, text, true)
  }

  private async _inputCommand(method: string, params: Record<string, unknown>): Promise<true> {
    return this.inspector.evaluate(`(async () => {
      const target = process.mainModule.require('electron').webContents.fromId(${this.targetId})
      if (!target || target.isDestroyed()) throw new Error('Simulator target has closed')
      if (!target.debugger.isAttached()) target.debugger.attach('1.3')
      await target.debugger.sendCommand(${JSON.stringify(method)}, ${JSON.stringify(params)})
      return true
    })()`)
  }

  async mouseClick(x: number, y: number): Promise<void> {
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

  insertText(text: string | number): Promise<true> {
    return this._inputCommand('Input.insertText', { text: String(text) })
  }

  async pressKey({ key, code, keyCode, modifiers = 0, commands }: KeyOptions): Promise<void> {
    const params: Omit<KeyOptions, 'keyCode'> & { windowsVirtualKeyCode: number } = {
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      modifiers,
    }
    if (commands) params.commands = commands
    await this._inputCommand('Input.dispatchKeyEvent', { ...params, type: 'rawKeyDown' })
    await this._inputCommand('Input.dispatchKeyEvent', { ...params, type: 'keyUp' })
  }

  async screenshot({ path: destination }: ScreenshotOptions = {}): Promise<Buffer> {
    const data: string = await this.inspector
      .evaluate(`process.mainModule.require('electron').webContents.fromId(${this.targetId})
      .capturePage().then(image => image.toPNG().toString('base64'))`)
    const buffer = Buffer.from(data, 'base64')
    if (destination) {
      fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true })
      fs.writeFileSync(destination, buffer)
    }
    return buffer
  }

  disconnect(): void {
    this.inspector.close()
  }

  async close(): Promise<void> {
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
