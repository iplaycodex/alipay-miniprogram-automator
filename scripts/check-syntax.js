const fs = require('node:fs')
const path = require('node:path')
const { Script } = require('node:vm')

const root = path.resolve(__dirname, '..')

function check(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name)
    if (entry.isDirectory()) check(filename)
    else if (entry.name.endsWith('.js')) {
      new Script(fs.readFileSync(filename, 'utf8'), { filename: path.relative(root, filename) })
    }
  }
}

for (const name of ['scripts', 'test', 'examples']) check(path.join(root, name))
new Script(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), { filename: 'index.js' })
console.log('JavaScript syntax checks passed')
