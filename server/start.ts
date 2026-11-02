import { resolve } from 'node:path'
import { SourceManager } from './manager'
import { createCountwellApp } from './http'

const dev = process.argv.includes('--dev')
const port = Number(process.env.COUNTWELL_PORT ?? (dev ? 5173 : 4173))
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('COUNTWELL_PORT 必须是 0–65535 的整数。')
const manager = new SourceManager({ configPath: resolve(process.env.COUNTWELL_CONFIG_DIR ?? '.countwell', 'source.json'), pythonPath: process.env.COUNTWELL_PYTHON })
const app = await createCountwellApp({ manager, dev })
app.server.on('error', () => { console.error('无法启动本机账本服务，请检查端口占用。'); process.exitCode = 1 })
app.server.listen(port, '127.0.0.1', () => {
  const address = app.server.address()
  console.log(`Countwell 本机账本服务：http://127.0.0.1:${typeof address === 'object' ? address?.port : port}/`)
  void manager.initialize()
})
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().then(() => process.exit(0)) })
