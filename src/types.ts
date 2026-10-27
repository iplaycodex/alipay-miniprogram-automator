import type { ChildProcess } from 'node:child_process'

export interface WaitOptions {
  timeout?: number
  interval?: number
  message?: string
}

export interface ConnectOptions extends WaitOptions {
  host?: '127.0.0.1' | 'localhost' | '::1'
  port?: number
  profilePath?: string
  inspectorTargetId?: string
  simulatorId?: number
  idePid?: number
  allowUnverifiedVersion?: boolean
}

export interface LaunchOptions extends Omit<
  ConnectOptions,
  'host' | 'inspectorTargetId' | 'idePid'
> {
  /** Native project or compiled Alipay output containing app.js and app.json. */
  projectPath: string
  idePath?: string
  logPath?: string
}

export interface SimulatorInfo {
  id: number
  title: string
}

export interface IDEInfo {
  ideVersion: string
  platform: NodeJS.Platform
  pid: number
  profilePath: string
  simulators: SimulatorInfo[]
  inspectorPort?: number
  projectPath?: string
  logPath?: string
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ScreenshotOptions {
  path?: string
}

export interface KeyOptions {
  key: string
  code: string
  keyCode: number
  modifiers?: number
  commands?: string[]
}

/** Minimal connection contract for constructing an SDK instance manually. */
export interface InspectorConnection {
  // Keep the existing manually supplied connection contract; wire values are decoded by callers.
  evaluate(expression: string, timeout?: number): Promise<any>
  close(): void
}

export type WaitResult<T> = Exclude<Awaited<T>, false | 0 | '' | null | undefined>
export type AutomatorError = Error & { code: string }

export interface OwnedIDE {
  child: ChildProcess
  profilePath: string
  port: number
  logPath: string
}

export type RendererResponse<T> =
  { ok: true; value: T } | { ok: false; message?: string; code?: string }
