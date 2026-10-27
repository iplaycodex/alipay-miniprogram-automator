const fs = require('node:fs')
const path = require('node:path')
const { Script } = require('node:vm')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'src')
const output = path.join(root, 'out')
const temporary = fs.mkdtempSync(path.join(root, '.build-'))

try {
  for (const name of fs.readdirSync(source).sort()) {
    if (!name.endsWith('.js')) continue
    const contents = fs.readFileSync(path.join(source, name), 'utf8')
    // Validate syntax without executing SDK or IDE code during packaging.
    new Script(contents, { filename: name })
    fs.writeFileSync(path.join(temporary, name), contents)
  }
  fs.copyFileSync(path.join(root, 'types/index.d.ts'), path.join(temporary, 'index.d.ts'))
  fs.rmSync(output, { recursive: true, force: true })
  fs.renameSync(temporary, output)
  console.error('Built out/ (CommonJS + TypeScript declarations)')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
