/// <reference types="node" />

declare namespace automator {
  interface WaitOptions {
    timeout?: number
    interval?: number
    message?: string
  }

  interface ConnectOptions extends WaitOptions {
    host?: '127.0.0.1' | 'localhost' | '::1'
    port?: number
    profilePath?: string
    inspectorTargetId?: string
    simulatorId?: number
    idePid?: number
    allowUnverifiedVersion?: boolean
  }

  interface LaunchOptions extends Omit<ConnectOptions, 'host' | 'inspectorTargetId' | 'idePid'> {
    /** Native project or compiled Alipay output containing app.js and app.json. */
    projectPath: string
    idePath?: string
    logPath?: string
  }

  interface SimulatorInfo {
    id: number
    title: string
  }

  interface IDEInfo {
    ideVersion: string
    platform: NodeJS.Platform
    pid: number
    profilePath: string
    simulators: SimulatorInfo[]
    inspectorPort?: number
    projectPath?: string
    logPath?: string
  }

  interface Bounds {
    x: number
    y: number
    width: number
    height: number
  }

  interface ScreenshotOptions {
    path?: string
  }

  interface KeyOptions {
    key: string
    code: string
    keyCode: number
    modifiers?: number
    commands?: string[]
  }

  /** Minimal connection contract for constructing an SDK instance manually. */
  interface InspectorConnection {
    evaluate(expression: string, timeout?: number): Promise<any>
    close(): void
  }

  type WaitResult<T> = Exclude<Awaited<T>, false | 0 | '' | null | undefined>

  function connect(options?: ConnectOptions): Promise<MiniProgram>
  function launch(options: LaunchOptions): Promise<MiniProgram>

  class MiniProgram {
    constructor(
      inspector: InspectorConnection,
      targetId: number,
      info: IDEInfo,
      options?: ConnectOptions,
    )
    static connect(options?: ConnectOptions): Promise<MiniProgram>
    info: IDEInfo
    targetId: number
    timeout: number
    interval: number
    inspector: InspectorConnection

    renderer<T = unknown>(expression: string): Promise<T>
    /** Runs in the IDE mini-program worker; cannot capture the caller's closure. */
    evaluate<Args extends unknown[], Result>(
      fn: (...args: Args) => Result,
      ...args: Args
    ): Promise<Awaited<Result>>
    evaluate<Result = unknown>(expression: string, ...args: unknown[]): Promise<Result>
    pageStack(): Promise<Page[]>
    currentPage(): Promise<Page | null>
    reLaunch(url: string): Promise<Page>
    navigateTo(url: string): Promise<Page>
    navigateBack(): Promise<Page>
    waitFor<T>(check: () => T, options?: WaitOptions): Promise<WaitResult<T>>
    waitFor<T>(check: () => T, message: string, timeout?: number): Promise<WaitResult<T>>
    query(selector: string, text?: string): Promise<Element | null>
    queryAll(selector: string, text?: string): Promise<Element[]>
    mouseClick(x: number, y: number): Promise<void>
    insertText(text: string | number): Promise<true>
    pressKey(options: KeyOptions): Promise<void>
    screenshot(options?: ScreenshotOptions): Promise<Buffer>
    disconnect(): void
    close(): Promise<void>
  }

  class Page {
    constructor(miniProgram: MiniProgram, route: string, query?: Record<string, unknown>)
    miniProgram: MiniProgram
    path: string
    query: Record<string, unknown>
    $(selector: string): Promise<Element | null>
    $$(selector: string): Promise<Element[]>
    waitFor(selector: string, options?: WaitOptions | number): Promise<Element>
  }

  class Element {
    constructor(miniProgram: MiniProgram, id: number, selector: string)
    miniProgram: MiniProgram
    id: number
    selector: string
    /** The callback receives a renderer DOM node, not a Node.js object. */
    inspect<Result>(fn: (node: any) => Result): Promise<Awaited<Result>>
    inspect<Result = unknown>(expression: string): Promise<Result>
    text(): Promise<string>
    value(): Promise<string | undefined>
    attribute(name: string): Promise<string | null>
    bounds(): Promise<Bounds>
    waitForStable(options?: WaitOptions | number): Promise<Bounds>
    tap(options?: WaitOptions): Promise<void>
    input(text: string | number): Promise<void>
    fill(text: string | number): Promise<void>
  }
}

export = automator
