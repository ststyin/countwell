import snapshotText from '../.countwell/cloud/ledger.snapshot.txt'
import { createCloudApp } from './app'
import type { SourceSnapshot } from '../src/lib/source-client'

// This text module belongs to the server bundle, outside the static assets.
// Parse it only after the authentication module authorizes a request.
let snapshot: SourceSnapshot | undefined
const app = createCloudApp(() => snapshot ??= JSON.parse(snapshotText) as SourceSnapshot)

export default app
