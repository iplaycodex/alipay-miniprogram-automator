import http from 'node:http'
import WebSocket from 'ws'
import { error } from './util'
import type { ConnectOptions } from './types'

interface InspectorTarget {
  id: string
  webSocketDebuggerUrl: string
}

interface InspectorMessage {
  id?: number
  result?: unknown
  error?: { message?: string }
}

interface EvaluationResult<T> {
  result?: { value?: T; unserializableValue?: string }
  exceptionDetails?: { exception?: { description?: string }; text?: string }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (cause: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

type InspectorOptions = Pick<ConnectOptions, 'host' | 'port' | 'inspectorTargetId' | 'timeout'>

function getJson(url: string, timeout: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(
          error('ERR_INSPECTOR_HTTP', `Inspector discovery returned HTTP ${response.statusCode}`),
        )
        return
      }
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
        if (body.length > 1024 * 1024)
          request.destroy(error('ERR_INSPECTOR_HTTP', 'Inspector discovery response is too large'))
      })
      response.on('error', reject)
      response.on('end', () => {
        try {
          resolve(JSON.parse(body) as unknown)
        } catch (_) {
          reject(error('ERR_INSPECTOR_HTTP', 'Inspector discovery did not return JSON'))
        }
      })
    })
    request.setTimeout(timeout, () =>
      request.destroy(error('ERR_TIMEOUT', 'Inspector discovery timed out')),
    )
    request.on('error', reject)
  })
}

export class Inspector {
  private sequence = 0
  readonly pending = new Map<number, PendingRequest>()
  private closed = false

  constructor(
    private socket: WebSocket,
    private timeout: number,
  ) {
    socket.on('message', (raw: WebSocket.RawData) => {
      let data: InspectorMessage
      try {
        data = JSON.parse(String(raw)) as InspectorMessage
      } catch (_) {
        this.fail(error('ERR_INSPECTOR_PROTOCOL', 'Inspector sent invalid JSON'))
        socket.close()
        return
      }
      if (data.id === undefined) return
      const pending = this.pending.get(data.id)
      if (!pending) return
      this.pending.delete(data.id)
      clearTimeout(pending.timer)
      if (data.error)
        pending.reject(
          error('ERR_INSPECTOR_PROTOCOL', data.error.message || 'Inspector command failed'),
        )
      else pending.resolve(data.result)
    })
    socket.on('error', (cause: Error) => this.fail(error('ERR_INSPECTOR_CLOSED', cause.message)))
    socket.on('close', () =>
      this.fail(error('ERR_INSPECTOR_CLOSED', 'Inspector connection closed')),
    )
  }

  static async connect({
    host = '127.0.0.1',
    port = 19387,
    inspectorTargetId,
    timeout = 15000,
  }: InspectorOptions = {}): Promise<Inspector> {
    if (!['127.0.0.1', 'localhost', '::1'].includes(host))
      throw error('ERR_OPTIONS', 'Only loopback inspector hosts are supported')
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw error('ERR_OPTIONS', 'port must be an integer between 1 and 65535')
    const address = host === '::1' ? '[::1]' : host
    const targets = await getJson(`http://${address}:${port}/json/list`, timeout)
    if (!Array.isArray(targets))
      throw error('ERR_INSPECTOR_TARGET', 'Inspector discovery did not return a target list')
    const available = (targets as InspectorTarget[]).filter(
      (target) => typeof target.webSocketDebuggerUrl === 'string',
    )
    const selected = inspectorTargetId
      ? available.find((target) => target.id === inspectorTargetId)
      : available.length === 1
        ? available[0]
        : null
    if (!selected)
      throw error(
        'ERR_INSPECTOR_TARGET',
        'Expected one inspector target; pass inspectorTargetId when there are multiple',
      )
    const endpoint = new URL(selected.webSocketDebuggerUrl)
    if (
      endpoint.protocol !== 'ws:' ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)
    )
      throw error('ERR_INSPECTOR_TARGET', 'Inspector WebSocket endpoint must be local')
    const socket = new WebSocket(endpoint, { handshakeTimeout: timeout })
    socket.on('error', () => {})
    await new Promise<void>((resolve, reject) => {
      const onOpen = () => {
        socket.off('error', onError)
        resolve()
      }
      const onError = (cause: Error) => {
        socket.off('open', onOpen)
        socket.terminate()
        reject(cause)
      }
      socket.once('open', onOpen)
      socket.once('error', onError)
    })
    return new Inspector(socket, timeout)
  }

  private fail(cause: Error): void {
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(cause)
    }
    this.pending.clear()
  }

  send<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeout = this.timeout,
  ): Promise<T> {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(error('ERR_INSPECTOR_CLOSED', 'Inspector connection is not open'))
    const id = ++this.sequence
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(error('ERR_TIMEOUT', `Inspector command timed out: ${method}`))
      }, timeout)
      this.pending.set(id, { resolve: (value) => resolve(value as T), reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }), (cause) => {
        if (!cause) return
        const pending = this.pending.get(id)
        if (pending) {
          this.pending.delete(id)
          clearTimeout(timer)
          reject(cause)
        }
      })
    })
  }

  async evaluate<T = unknown>(expression: string, timeout?: number): Promise<T> {
    const result = await this.send<EvaluationResult<T>>(
      'Runtime.evaluate',
      { expression, awaitPromise: true, returnByValue: true },
      timeout,
    )
    if (result.exceptionDetails) {
      const details = result.exceptionDetails
      throw error(
        'ERR_EVALUATE',
        details.exception?.description || details.text || 'IDE evaluation failed',
      )
    }
    if (result.result?.unserializableValue !== undefined)
      throw error('ERR_EVALUATE', 'Result is not JSON serializable')
    return result.result?.value as T
  }

  close(): void {
    this.fail(error('ERR_INSPECTOR_CLOSED', 'Inspector connection was disconnected'))
    this.socket.close()
  }
}
