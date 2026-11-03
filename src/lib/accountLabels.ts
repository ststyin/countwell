import type { LedgerAccount } from '../domain/types'

/** Add the shortest account-path context needed to distinguish identical labels. */
export function accountLabels(accounts: LedgerAccount[]): Map<string, string> {
  const groups = new Map<string, LedgerAccount[]>()
  for (const account of accounts) groups.set(account.label, [...(groups.get(account.label) ?? []), account])
  return new Map(accounts.map(account => {
    const peers = groups.get(account.label)!
    if (peers.length === 1) return [account.name, account.label]
    const parents = account.name.split(':').slice(0, -1)
    let depth = 1
    while (depth < parents.length && peers.some(peer => peer.name !== account.name && peer.name.split(':').slice(0, -1).slice(-depth).join(':') === parents.slice(-depth).join(':'))) depth++
    const context = parents.slice(-depth).join(' · ')
    return [account.name, context ? `${context} · ${account.label}` : account.label]
  }))
}
