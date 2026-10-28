const test = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { WebSocketServer } = require('ws')
const { Inspector } = require('../out/inspector')
const { MiniProgram } = require('../out/mini-program')

async function startupFixture(t, mode = 'recover') {
  let workerCalls = 0
  const server = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(
      JSON.stringify([
        { id: 'startup', webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}` },
      ]),
    )
  })
  const sockets = new WebSocketServer({ server })
  sockets.on('connection', (socket) =>
    socket.on('message', (raw) => {
      const { id, params } = JSON.parse(String(raw))
      let value = false
      if (params.expression.includes('getCurrentPages')) {
        workerCalls++
        if (mode === 'timeout' || (mode === 'recover' && workerCalls === 1)) return
        if (mode === 'closed') return socket.close()
        if (mode === 'error') {
          socket.send(
            JSON.stringify({
              id,
              result: {
                result: {
                  value: {
                    ok: false,
                    code: 'ERR_RENDERER',
                    message: 'Business initialization failed',
                  },
                },
              },
            }),
          )
          return
        }
        value = [{ path: 'pages/index/index', id: '1', viewId: '1', query: {} }]
      } else if (params.expression.includes('__alipayAutomatorDocuments'))
        value = { 1: 'document-1' }
      socket.send(JSON.stringify({ id, result: { result: { value: { ok: true, value } } } }))
    }),
  )
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const inspector = await Inspector.connect({ port: server.address().port, timeout: 30 })
  t.after(async () => {
    inspector.close()
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
    await new Promise((resolve) => server.close(resolve))
  })
  const app = new MiniProgram(inspector, 5, {}, { timeout: 30, interval: 5 })
  return { app, inspector, calls: () => workerCalls }
}

test('startup recovers when worker probing outlasts one inspector command', async (t) => {
  const { app, inspector, calls } = await startupFixture(t)
  const pages = await app._waitForReady(800, { retryTimeouts: true })
  assert.equal(pages[0].path, 'pages/index/index')
  assert(calls() >= 4, 'A timeout must be followed by stable successful page snapshots')
  assert.equal(inspector.pending.size, 0)
})

test('startup stops at its deadline when worker commands keep timing out', async (t) => {
  const { app, calls } = await startupFixture(t, 'timeout')
  const started = Date.now()
  await assert.rejects(app._waitForReady(160, { retryTimeouts: true }), {
    code: 'ERR_TIMEOUT',
    message: 'Mini-program worker and renderer did not become ready',
  })
  assert(calls() > 1)
  assert(Date.now() - started < 600)
})

test('ordinary readiness checks do not retry action timeouts', async (t) => {
  const { app, calls } = await startupFixture(t)
  await assert.rejects(app._waitForReady(800), {
    code: 'ERR_TIMEOUT',
    message: 'Inspector command timed out: Runtime.evaluate',
  })
  assert.equal(calls(), 1)
})

for (const [mode, code] of [
  ['closed', 'ERR_INSPECTOR_CLOSED'],
  ['error', 'ERR_RENDERER'],
]) {
  test(`startup does not hide ${code}`, async (t) => {
    const { app, calls } = await startupFixture(t, mode)
    await assert.rejects(app._waitForReady(800, { retryTimeouts: true }), { code })
    assert.equal(calls(), 1)
  })
}

test('startup checks owned process liveness before each retry', async (t) => {
  const { app, calls } = await startupFixture(t)
  let checks = 0
  await assert.rejects(
    app._waitForReady(800, {
      retryTimeouts: true,
      checkProcess() {
        if (++checks === 2) throw Object.assign(new Error('IDE exited'), { code: 'ERR_IDE_EXIT' })
      },
    }),
    { code: 'ERR_IDE_EXIT' },
  )
  assert.equal(calls(), 1)
})

test('launch shares its timeout across connection, import and readiness', async (t) => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const { EventEmitter } = require('node:events')
  const childProcess = require('node:child_process')
  const importer = require('../out/project-importer')
  const automator = require('..')
  const profile = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'alipay-budget-test-')))
  t.after(() => fs.rmSync(profile, { recursive: true, force: true }))
  const child = Object.assign(new EventEmitter(), {
    pid: 987654321,
    exitCode: null,
    signalCode: null,
  })
  const delay = () => new Promise((resolve) => setTimeout(resolve, 35))
  let probeBudget,
    closed = false
  const sentinel = Object.assign(new Error('readiness deadline reached'), { code: 'ERR_TIMEOUT' })
  t.mock.method(childProcess, 'spawn', () => child)
  t.mock.method(process, 'kill', (pid) => {
    assert.equal(pid, -child.pid)
    return true
  })
  t.mock.method(Inspector, 'connect', async () => {
    await delay()
    return {
      evaluate: async () => ({ pid: child.pid, profilePath: profile, ideVersion: '3.10.5' }),
      close() {},
    }
  })
  t.mock.method(importer, 'openProject', async (_, __, remaining) => {
    assert.equal(typeof remaining, 'function')
    await delay()
  })
  t.mock.method(MiniProgram, 'connect', async () => {
    await delay()
    return {
      info: {},
      async _waitForReady(budget, options) {
        probeBudget = budget
        assert.equal(options.retryTimeouts, true)
        assert.equal(typeof options.checkProcess, 'function')
        throw sentinel
      },
      async close() {
        closed = true
      },
    }
  })
  await assert.rejects(
    automator.launch({
      projectPath: path.resolve('examples/native-miniapp'),
      idePath: process.execPath,
      profilePath: profile,
      timeout: 1000,
    }),
    (error) => error === sentinel,
  )
  assert(
    probeBudget > 0 && probeBudget < 910,
    `Startup must consume one budget, received ${probeBudget}`,
  )
  assert.equal(closed, true)
})
