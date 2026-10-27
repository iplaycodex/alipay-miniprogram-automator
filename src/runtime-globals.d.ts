// Only available inside callbacks serialized into the official mini-program worker.
// These declarations are build-time input and do not add globals to SDK consumers.
declare function getCurrentPages(): Array<{
  route?: string
  __route__?: string
  options?: Record<string, unknown>
}>

declare const my: {
  [method: string]: (options?: { url: string }) => void
}
