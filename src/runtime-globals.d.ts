// Only available inside callbacks serialized into the official mini-program worker.
// These declarations are build-time input and do not add globals to SDK consumers.
declare function getCurrentPages(): Array<{
  route?: string
  __route__?: string
  $id: string | number
  $viewId: string | number
  getLoadOptions(): Record<string, unknown>
}>

declare const my: {
  [method: string]: (options: {
    url?: string
    success: () => void
    fail: (cause: { error?: string | number; errorMessage?: string; errMsg?: string }) => void
  }) => void
}
