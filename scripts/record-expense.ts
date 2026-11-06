import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOfficialLedger } from '../server/engine'
import { expenseDirective, hasRecordedExpense, validateExpense } from '../src/recording/expense'

/** Prepare and validate a candidate in a private checkout before any Git push. */
export async function recordExpense(rootPath: string, entryPath: string, input: unknown): Promise<{ created: boolean; file: string }> {
  const root = await realpath(rootPath)
  if (entryPath !== 'main.beancount') throw new Error('当前只支持根目录中的 main.beancount 入口。')
  const entry = resolve(root, entryPath)
  const original = await loadOfficialLedger(entry, { sourceRoot: root })
  const draft = validateExpense(input, original)
  if (hasRecordedExpense(original, draft.id)) return { created: false, file: '' }
  const file = `transactions/${draft.date.slice(0, 4)}/${draft.date.slice(5, 7)}.beancount`
  const target = resolve(root, file)
  await mkdir(dirname(target), { recursive: true })
  const parent = await realpath(dirname(target))
  if (relative(root, parent).startsWith(`..${sep}`) || relative(root, parent) === '..') throw new Error('账本路径越界。')
  let content = ''
  try {
    const stat = await lstat(target)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('账本文件不是普通文件。')
    content = await readFile(target, 'utf8')
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  const entryContent = await readFile(entry, 'utf8')
  const include = `include "${file}"`
  await writeFile(target, `${content}${content && !content.endsWith('\n') ? '\n' : ''}\n${expenseDirective(draft)}`, 'utf8')
  const candidate = await loadOfficialLedger(entry, { sourceRoot: root })
  // The file may already be included by a glob or a nested include.
  if (!candidate.files.some(source => source.path === file)) {
    await writeFile(entry, `${entryContent}${entryContent.endsWith('\n') ? '' : '\n'}${include}\n`, 'utf8')
    await loadOfficialLedger(entry, { sourceRoot: root })
  }
  return { created: true, file }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const payload = process.env.COUNTWELL_EXPENSE_PAYLOAD
    if (!payload || payload.length > 12_000 || !/^[A-Za-z0-9+/=]+$/.test(payload)) throw new Error('请求数据无效。')
    const draft: unknown = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'))
    if (!draft || typeof draft !== 'object' || (draft as { id?: unknown }).id !== process.env.COUNTWELL_REQUEST_ID) throw new Error('请求编号不匹配。')
    await recordExpense(process.env.COUNTWELL_LEDGER_DIR ?? '', process.env.COUNTWELL_LEDGER_ENTRY ?? '', draft)
  } catch { console.error('支出记录未通过账本校验，未提交到主分支。'); process.exitCode = 1 }
}
