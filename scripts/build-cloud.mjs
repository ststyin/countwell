import { build } from 'vite'
import { execFileSync } from 'node:child_process'

let appRevision = ''
try {
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  if (/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) appRevision = head
} catch { /* A source archive does not have a Git revision. */ }

await build({
  define: {
    'import.meta.env.VITE_COUNTWELL_CLOUD': JSON.stringify('true'),
    'import.meta.env.VITE_COUNTWELL_APP_REVISION': JSON.stringify(appRevision),
  },
  build: { outDir: 'dist-private' },
})
