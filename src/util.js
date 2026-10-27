const fs = require('node:fs')
const path = require('node:path')
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

function normalizePath(value) {
  const resolved = path.resolve(value)
  return fs.existsSync(resolved) ? fs.realpathSync(resolved) : resolved
}

function error(code, message) {
  return Object.assign(new Error(message), { code })
}

async function waitFor(check, { timeout = 15000, interval = 100, message = 'Condition timed out' } = {}) {
  const deadline = Date.now() + timeout
  do {
    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    let timer
    try {
      const result = await Promise.race([
        Promise.resolve().then(check),
        new Promise((_, reject) => { timer = setTimeout(() => reject(error('ERR_TIMEOUT', message)), remaining) })
      ])
      if (result) return result
    } finally { clearTimeout(timer) }
    await sleep(Math.min(interval, Math.max(0, deadline - Date.now())))
  } while (Date.now() < deadline)
  throw error('ERR_TIMEOUT', message)
}

module.exports = { sleep, waitFor, error, normalizePath }
