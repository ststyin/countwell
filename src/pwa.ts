export interface PwaState {
  installAvailable: boolean;
  updateAvailable: boolean;
  offline: boolean;
  offlineReady: boolean;
  isStandalone: boolean;
  installed: boolean;
  ios: boolean;
  registrationError: boolean;
}

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export type InstallResult = 'accepted' | 'dismissed' | 'unavailable';

const serverState: PwaState = {
  installAvailable: false,
  updateAvailable: false,
  offline: false,
  offlineReady: false,
  isStandalone: false,
  installed: false,
  ios: false,
  registrationError: false,
};

const browser = typeof window !== 'undefined';
let state: PwaState = { ...serverState };
let deferredPrompt: InstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;
let reloadForUpdate = false;
let watchedController: ServiceWorker | null = null;
const listeners = new Set<() => void>();

function update(next: Partial<PwaState>) {
  const candidate = { ...state, ...next };
  if ((Object.keys(candidate) as (keyof PwaState)[]).every(key => candidate[key] === state[key])) return;
  state = candidate;
  listeners.forEach(listener => listener());
}

function reflectControllerState() {
  const offlineReady = navigator.serviceWorker.controller?.state === 'activated';
  update({ offlineReady, ...(offlineReady ? { registrationError: false } : {}) });
  if (offlineReady && reloadForUpdate) {
    reloadForUpdate = false;
    window.location.reload();
  }
}

function watchController() {
  const controller = navigator.serviceWorker.controller;
  if (watchedController !== controller) {
    watchedController?.removeEventListener('statechange', reflectControllerState);
    watchedController = controller;
    controller?.addEventListener('statechange', reflectControllerState);
  }
  reflectControllerState();
}

if (browser) {
  const displayMode = window.matchMedia('(display-mode: standalone)');
  const standalone = () => displayMode.matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  state = {
    ...state,
    offline: !navigator.onLine,
    isStandalone: standalone(),
    installed: standalone(),
    ios: /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  };
  window.addEventListener('online', () => update({ offline: false }));
  window.addEventListener('offline', () => update({ offline: true }));
  displayMode.addEventListener('change', () => update({ isStandalone: standalone() }));
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event as InstallPromptEvent;
    update({ installAvailable: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    update({ installAvailable: false, installed: true });
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', watchController);
    watchController();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void registration?.update().catch(() => undefined);
  });
}

export function subscribePwa(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getPwaState(): PwaState {
  return state;
}

export function getPwaServerState(): PwaState {
  return serverState;
}

/** Call once from the app entry. Development mode deliberately avoids a worker. */
export function registerPwa(): Promise<ServiceWorkerRegistration | null> {
  if (registrationPromise) return registrationPromise;
  if (!browser || !('serviceWorker' in navigator) || !window.isSecureContext || !import.meta.env.PROD) {
    return Promise.resolve(null);
  }
  registrationPromise = navigator.serviceWorker.register('/sw.js', {
    scope: '/', updateViaCache: 'none',
  }).then(result => {
    registration = result;
    void navigator.serviceWorker.ready.then(watchController).catch(() => undefined);
    if (result.waiting && navigator.serviceWorker.controller) update({ updateAvailable: true });
    const watchInstallingWorker = () => {
      const installing = result.installing;
      if (!installing) return;
      installing.addEventListener('statechange', () => {
        if (installing.state === 'installed' && navigator.serviceWorker.controller) {
          update({ updateAvailable: true });
        }
      });
    };
    result.addEventListener('updatefound', watchInstallingWorker);
    watchInstallingWorker();
    return result;
  }).catch(() => {
    update({ registrationError: !state.offlineReady });
    return null;
  });
  return registrationPromise;
}

export async function installPwa(): Promise<InstallResult> {
  const prompt = deferredPrompt;
  if (!prompt) return 'unavailable';
  deferredPrompt = null;
  update({ installAvailable: false });
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    return choice.outcome;
  } catch {
    return 'unavailable';
  }
}

export function applyPwaUpdate(): boolean {
  const waiting = registration?.waiting;
  if (!waiting) return false;
  reloadForUpdate = true;
  waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}
