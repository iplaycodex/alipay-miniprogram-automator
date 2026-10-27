const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { WebSocketServer } = require('ws')
const { Inspector } = require('../src/inspector')
const { MiniProgram } = require('../src/mini-program')
const { waitFor } = require('../src/util')
const automator = require('..')

async function fixture(t, handler, discovery) {
  let port
  const server = http.createServer((request, response) => {
    if (discovery) return discovery(request, response, port)
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify([{ id: 'test', webSocketDebuggerUrl: `ws://127.0.0.1:${port}` }]))
  })
  const sockets = new WebSocketServer({ server })
  sockets.on('connection', socket => socket.on('message', raw => handler(socket, JSON.parse(String(raw)))))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  port = server.address().port
  t.after(async () => {
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    await new Promise(resolve => server.close(resolve))
  })
  return { port, sockets }
}

const reply = (socket, id, value) => socket.send(JSON.stringify({ id, result: { result: { value } } }))

test('concurrent inspector commands resolve against their own request IDs', async t => {
  const f = await fixture(t, (socket, message) => {
    setTimeout(() => reply(socket, message.id, message.params.expression), message.id === 1 ? 20 : 1)
  })
  const inspector = await Inspector.connect(f)
  t.after(() => inspector.close())
  assert.deepEqual(await Promise.all([inspector.evaluate('first'), inspector.evaluate('second')]), ['first', 'second'])
})

test('protocol errors and JavaScript exceptions retain useful messages', async t => {
  const f = await fixture(t, (socket, message) => {
    socket.send(JSON.stringify(message.params.expression === 'protocol'
      ? { id: message.id, error: { message: 'Command not supported' } }
      : { id: message.id, result: { exceptionDetails: { exception: { description: 'Error: application failed' } } } }))
  })
  const inspector = await Inspector.connect(f)
  t.after(() => inspector.close())
  await assert.rejects(inspector.evaluate('protocol'), { code: 'ERR_INSPECTOR_PROTOCOL', message: 'Command not supported' })
  await assert.rejects(inspector.evaluate('exception'), { code: 'ERR_EVALUATE', message: 'Error: application failed' })
})

test('closing the socket promptly rejects pending commands', async t => {
  const f = await fixture(t, socket => socket.close())
  const inspector = await Inspector.connect(f)
  await assert.rejects(inspector.evaluate('pending'), { code: 'ERR_INSPECTOR_CLOSED' })
  assert.equal(inspector.pending.size, 0)
})

test('timeouts remove pending requests and late results cannot affect later commands', async t => {
  const f = await fixture(t, (socket, message) => {
    if (message.params.expression === 'fast') reply(socket, message.id, 'ok')
  })
  const inspector = await Inspector.connect({ ...f, timeout: 30 })
  t.after(() => inspector.close())
  await assert.rejects(inspector.evaluate('slow'), { code: 'ERR_TIMEOUT' })
  assert.equal(inspector.pending.size, 0)
  assert.equal(await inspector.evaluate('fast'), 'ok')
})

test('disconnect rejects later commands instead of leaving a timer running', async t => {
  const f = await fixture(t, () => {})
  const inspector = await Inspector.connect(f)
  inspector.close()
  await assert.rejects(inspector.evaluate('after close'), { code: 'ERR_INSPECTOR_CLOSED' })
})

test('invalid discovery responses and remote WebSocket redirects are rejected', async t => {
  const f = await fixture(t, () => {}, (_, response) => {
    response.end(JSON.stringify([{ id: 'unsafe', webSocketDebuggerUrl: 'ws://example.com/debug' }]))
  })
  await assert.rejects(Inspector.connect(f), { code: 'ERR_INSPECTOR_TARGET' })
  await assert.rejects(Inspector.connect({ host: 'example.com' }), { code: 'ERR_OPTIONS' })
})

test('non-JSON discovery and HTTP failures are diagnostic errors', async t => {
  const f = await fixture(t, () => {}, (_, response) => { response.statusCode = 503; response.end('unavailable') })
  await assert.rejects(Inspector.connect(f), { code: 'ERR_INSPECTOR_HTTP' })
  const invalid = await fixture(t, () => {}, (_, response) => response.end('<html>not an inspector</html>'))
  await assert.rejects(Inspector.connect(invalid), { code: 'ERR_INSPECTOR_HTTP' })
})

test('multiple targets require an explicit selection', async t => {
  const f = await fixture(t, (socket, message) => reply(socket, message.id, true), (_, response, port) => {
    response.end(JSON.stringify(['one', 'two'].map(id => ({ id, webSocketDebuggerUrl: `ws://127.0.0.1:${port}` }))))
  })
  await assert.rejects(Inspector.connect(f), { code: 'ERR_INSPECTOR_TARGET' })
  const inspector = await Inspector.connect({ ...f, inspectorTargetId: 'two' })
  t.after(() => inspector.close())
  assert.equal(await inspector.evaluate('selected'), true)
})

test('connect refuses an unexpected profile or IDE version', async t => {
  const f = await fixture(t, (socket, message) => reply(socket, message.id, {
    ideVersion: '3.10.5', profilePath: '/tmp/expected-profile', simulators: [{ id: 5, title: 'Simulator' }]
  }))
  await assert.rejects(MiniProgram.connect({ ...f, profilePath: '/tmp/other-profile' }), { code: 'ERR_IDE_PROFILE' })
  const other = await fixture(t, (socket, message) => reply(socket, message.id, {
    ideVersion: '99.0.0', profilePath: '/tmp/expected-profile', simulators: [{ id: 5 }]
  }))
  await assert.rejects(MiniProgram.connect(other), { code: 'ERR_UNSUPPORTED_IDE' })
})

test('wait deadlines also cover a check that never resolves', async () => {
  const start = Date.now()
  await assert.rejects(waitFor(() => new Promise(() => {}), { timeout: 30 }), { code: 'ERR_TIMEOUT' })
  assert(Date.now() - start < 500)
})

test('launch validates build output before trying to start an IDE', async () => {
  await assert.rejects(automator.launch(), { code: 'ERR_OPTIONS' })
  await assert.rejects(automator.launch({ projectPath: __dirname }), { code: 'ERR_OPTIONS' })
})
