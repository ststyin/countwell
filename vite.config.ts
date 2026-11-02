import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

function builtFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? builtFiles(join(directory, entry.name)) : [join(directory, entry.name)],
  ).sort()
}

let outputDirectory = resolve('dist')

export default defineConfig({
  plugins: [react(), {
    name: 'version-pwa-shell',
    apply: 'build',
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir)
    },
    closeBundle() {
      const hash = createHash('sha256')
      hash.update(readFileSync('public/sw.js'))
      for (const file of builtFiles(outputDirectory).filter(file => file !== join(outputDirectory, 'sw.js'))) {
        hash.update(relative(outputDirectory, file)).update(readFileSync(file))
      }
      const version = hash.digest('hex').slice(0, 16)
      const worker = readFileSync(join(outputDirectory, 'sw.js'), 'utf8')
      writeFileSync(join(outputDirectory, 'sw.js'), worker.replace(/const SHELL_VERSION = '[^']+';/, `const SHELL_VERSION = '${version}';`))
    },
  }],
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
