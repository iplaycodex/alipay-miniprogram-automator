const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const output = path.join(root, 'out')
const temporary = fs.mkdtempSync(path.join(root, '.build-'))

try {
  const compilerPackage = require.resolve('typescript/package.json')
  const compiler = path.resolve(path.dirname(compilerPackage), require(compilerPackage).bin.tsc)
  // Compile to a temporary directory so a type error cannot replace the last good build.
  execFileSync(
    process.execPath,
    [compiler, '--project', path.join(root, 'tsconfig.json'), '--outDir', temporary],
    {
      cwd: root,
      stdio: 'inherit',
    },
  )
  fs.rmSync(output, { recursive: true, force: true })
  fs.renameSync(temporary, output)
  console.error('Built out/ (CommonJS + TypeScript declarations)')
} finally {
  fs.rmSync(temporary, { recursive: true, force: true })
}
