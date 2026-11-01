import source from './demo.beancount?raw';
import { parseDemoLedger } from '../domain/parser';
import type { Ledger } from '../domain/types';

export const demoSource = source;
let cached:Ledger | undefined;

/** Bundled fictional data only; this function never fetches a private repository. */
export function loadDemoLedger():Ledger {
  cached ??= parseDemoLedger(source,'2026-10');
  return cached;
}
