import { useSyncExternalStore } from 'react';
import {
  applyPwaUpdate,
  getPwaServerState,
  getPwaState,
  installPwa,
  subscribePwa,
} from '../pwa';

/** Shared install/update/offline state without duplicate browser listeners. */
export function usePwa() {
  const state = useSyncExternalStore(subscribePwa, getPwaState, getPwaServerState);
  return { ...state, install: installPwa, applyUpdate: applyPwaUpdate };
}
