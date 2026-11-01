import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function builtFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? builtFiles(join(directory, entry.name)) : [join(directory, entry.name)],
  ).sort()
}

export default defineConfig({
  plugins: [react(), {
    name: 'version-pwa-shell',
    apply: 'build',
    closeBundle() {
      const hash = createHash('sha256')
      hash.update(readFileSync('public/sw.js'))
      for (const file of builtFiles('dist').filter(file => file !== join('dist', 'sw.js'))) {
        hash.update(file).update(readFileSync(file))
      }
      const version = hash.digest('hex').slice(0, 16)
      const worker = readFileSync('dist/sw.js', 'utf8')
      writeFileSync('dist/sw.js', worker.replace(/const SHELL_VERSION = '[^']+';/, `const SHELL_VERSION = '${version}';`))
    },
  }],
  build: { target: 'es2022' },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
})
