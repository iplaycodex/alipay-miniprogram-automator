const http = require('node:http')
const WebSocket = require('ws')
const { error } = require('./util')

function getJson(url, timeout) {
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
          resolve(JSON.parse(body))
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

class Inspector {
  constructor(socket, timeout) {
    this.socket = socket
    this.timeout = timeout
    this.sequence = 0
    this.pending = new Map()
    this.closed = false
    socket.on('message', (raw) => {
      let data
      try {
        data = JSON.parse(String(raw))
      } catch (_) {
        this.fail(error('ERR_INSPECTOR_PROTOCOL', 'Inspector sent invalid JSON'))
        socket.close()
        return
      }
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
    socket.on('error', (cause) => this.fail(error('ERR_INSPECTOR_CLOSED', cause.message)))
    socket.on('close', () =>
      this.fail(error('ERR_INSPECTOR_CLOSED', 'Inspector connection closed')),
    )
  }

  static async connect({
    host = '127.0.0.1',
    port = 19387,
    inspectorTargetId,
    timeout = 15000,
  } = {}) {
    if (!['127.0.0.1', 'localhost', '::1'].includes(host))
      throw error('ERR_OPTIONS', 'Only loopback inspector hosts are supported')
    if (!Number.isInteger(port) || port < 1 || port > 65535)
      throw error('ERR_OPTIONS', 'port must be an integer between 1 and 65535')
    const address = host === '::1' ? '[::1]' : host
    const targets = await getJson(`http://${address}:${port}/json/list`, timeout)
    if (!Array.isArray(targets))
      throw error('ERR_INSPECTOR_TARGET', 'Inspector discovery did not return a target list')
    const available = targets.filter((target) => typeof target.webSocketDebuggerUrl === 'string')
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
    ) {
      throw error('ERR_INSPECTOR_TARGET', 'Inspector WebSocket endpoint must be local')
    }
    const socket = new WebSocket(endpoint, { handshakeTimeout: timeout })
    socket.on('error', () => {})
    await new Promise((resolve, reject) => {
      const onOpen = () => {
        socket.off('error', onError)
        resolve()
      }
      const onError = (cause) => {
        socket.off('open', onOpen)
        socket.terminate()
        reject(cause)
      }
      socket.once('open', onOpen)
      socket.once('error', onError)
    })
    return new Inspector(socket, timeout)
  }

  fail(cause) {
    this.closed = true
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(cause)
    }
    this.pending.clear()
  }

  send(method, params = {}, timeout = this.timeout) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(error('ERR_INSPECTOR_CLOSED', 'Inspector connection is not open'))
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(error('ERR_TIMEOUT', `Inspector command timed out: ${method}`))
      }, timeout)
      this.pending.set(id, { resolve, reject, timer })
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

  async evaluate(expression, timeout) {
    const result = await this.send(
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
    return result.result?.value
  }

  close() {
    this.fail(error('ERR_INSPECTOR_CLOSED', 'Inspector connection was disconnected'))
    this.socket.close()
  }
}

module.exports = { Inspector }
