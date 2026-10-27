import { MiniProgram as MiniProgramClass } from './mini-program'
import { Page as PageClass } from './page'
import { Element as ElementClass } from './element'
import { launch } from './launcher'
import type * as Types from './types'

const automator = {
  connect: (options?: Types.ConnectOptions): Promise<MiniProgramClass> =>
    MiniProgramClass.connect(options),
  launch,
  MiniProgram: MiniProgramClass,
  Page: PageClass,
  Element: ElementClass,
}

// Type-only namespace preserves existing `automator.Page`/`automator.LaunchOptions` usage.
// Runtime exports remain the same five properties on a CommonJS object.
namespace automator {
  export type MiniProgram = MiniProgramClass
  export type Page = PageClass
  export type Element = ElementClass
  export type WaitOptions = Types.WaitOptions
  export type ConnectOptions = Types.ConnectOptions
  export type LaunchOptions = Types.LaunchOptions
  export type SimulatorInfo = Types.SimulatorInfo
  export type IDEInfo = Types.IDEInfo
  export type Bounds = Types.Bounds
  export type ScreenshotOptions = Types.ScreenshotOptions
  export type KeyOptions = Types.KeyOptions
  export type InspectorConnection = Types.InspectorConnection
  export type WaitResult<T> = Types.WaitResult<T>
}

export = automator
