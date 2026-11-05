import type { Ledger } from '../domain/types'

/** A fund name immediately above an account declaration is a display hint only.
 * Require a six-digit fund code; never use arbitrary transaction comments. */
export function investmentLabels(ledger: Ledger): Map<string, string> {
  const labels = new Map<string, string>()
  for (const file of ledger.files ?? [{ content: ledger.source }]) {
    const lines = file.content.split(/\r?\n/)
    for (let index = 1; index < lines.length; index++) {
      const opening = lines[index].match(/^\d{4}-\d{2}-\d{2}\s+open\s+(\S+)/)
      const comment = lines[index - 1].match(/^\s*;\s*([^;]+?\s+[（(]?\d{6}[）)]?)(?:\s*[（(]已卖出[）)])?\s*$/)
      if (opening && comment) labels.set(opening[1], comment[1].trim())
    }
  }
  for (const account of ledger.accounts) {
    if (account.label && account.label !== account.name.split(':').at(-1)) labels.set(account.name, account.label)
  }
  return labels
}
