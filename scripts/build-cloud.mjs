import { build } from 'vite'

await build({
  define: { 'import.meta.env.VITE_COUNTWELL_CLOUD': JSON.stringify('true') },
  build: { outDir: 'dist-private' },
})
