import type { LedgerAccount } from '../domain/types'

/** Show the complete account path below its root, regardless of its depth. */
export function accountLabels(accounts: LedgerAccount[]): Map<string, string> {
  return new Map(accounts.map(account => {
    const path = account.name.split(':').slice(1).join(':')
    return [account.name, path || account.name]
  }))
}
