import { useSyncExternalStore } from "react";
import { hasUnsavedEdits } from "./unsavedEdits";

// New deployments (FLOW-325). The service worker (FLOW-150, vite-plugin-pwa in
// "prompt" mode) precaches each version. A new one installs in the background and
// waits; this module decides when it takes over:
// - shortly after the app opens (nothing typed yet): at once, so a fresh load or
//   new tab shows the new version on the first or second load;
// - later: on the next navigation, or when the person presses Reload on the
//   "New version" notice, and never by itself while there are unsaved edits.
// An open tab looks for a new version every few minutes and when it comes back
// into view. A lazy chunk a deploy removed reloads the app once.

export const UPDATE_CHECK_MS = 5 * 60_000;
// Tab focus checks at most this often.
export const FOCUS_CHECK_MS = 60_000;
// A new version found this soon after the app opened applies without asking.
export const FRESH_LOAD_MS = 10_000;
// After pressing Reload, reload anyway if the new worker hasn't taken over.
const APPLY_FALLBACK_MS = 4_000;
const CHUNK_RELOAD_KEY = "flowbase.chunk-reload";
// A second chunk failure within this time shows the error instead of looping.
const CHUNK_RELOAD_WINDOW_MS = 60_000;

type RegisterOptions = {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onNeedReload?: () => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
};
export type RegisterSW = (options: RegisterOptions) => (reloadPage?: boolean) => Promise<void>;

type Env = {
  window: Window;
  now: () => number;
  reload: () => void;
  hasUnsavedEdits: () => boolean;
};

let waiting = false;
const listeners = new Set<() => void>();
const setWaiting = (value: boolean) => {
  if (waiting === value) return;
  waiting = value;
  listeners.forEach((listener) => listener());
};

let applyUpdate: () => void = () => undefined;

// Whether a new version is ready and waiting for a reload.
export const useUpdateWaiting = () =>
  useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => waiting,
    () => false,
  );

// The notice's Reload button.
export const reloadToUpdate = () => applyUpdate();

export function startAppUpdates(register: RegisterSW, overrides: Partial<Env> = {}) {
  const env: Env = {
    window,
    now: () => Date.now(),
    reload: () => window.location.reload(),
    hasUnsavedEdits: () => hasUnsavedEdits(),
    ...overrides,
  };
  const startedAt = env.now();
  let applying = false;
  let lastCheck = startedAt;
  let registration: ServiceWorkerRegistration | undefined;
  let interval: number | undefined;
  let stopped = false;

  const check = () => {
    lastCheck = env.now();
    // Offline, or the server is unreachable: try again at the next check.
    registration?.update().catch(() => undefined);
  };

  const updateSW = register({
    // A new version is installed and waiting.
    onNeedRefresh: () => {
      if (env.now() - startedAt < FRESH_LOAD_MS && !env.hasUnsavedEdits()) apply();
      else setWaiting(true);
    },
    // The new version took over (this tab asked, or another tab did): reload,
    // unless that would lose unsaved edits; then the notice stays until Reload.
    onNeedReload: () => {
      if (applying || !env.hasUnsavedEdits()) env.reload();
      else setWaiting(true);
    },
    onRegisteredSW: (_url, reg) => {
      registration = reg;
      if (!reg || stopped) return;
      interval = env.window.setInterval(check, UPDATE_CHECK_MS);
    },
  });

  function apply() {
    if (applying) return;
    applying = true;
    void updateSW(true);
    // If no worker is waiting (it already took over from another tab), or the
    // takeover doesn't come back, a plain reload gets the new version.
    env.window.setTimeout(() => env.reload(), APPLY_FALLBACK_MS);
  }
  applyUpdate = apply;

  const onFocus = () => {
    if (env.window.document.visibilityState === "hidden") return;
    if (env.now() - lastCheck >= FOCUS_CHECK_MS) check();
  };
  // The next navigation picks up a waiting version, when nothing is unsaved.
  const onNavigate = () => {
    if (waiting && !env.hasUnsavedEdits()) apply();
  };
  // A chunk from the old version that a deploy removed (Vite's preload helper).
  const onPreloadError = (event: Event) => {
    if (reloadForStaleChunk(env)) event.preventDefault();
  };
  env.window.addEventListener("focus", onFocus);
  env.window.document.addEventListener("visibilitychange", onFocus);
  env.window.addEventListener("hashchange", onNavigate);
  env.window.addEventListener("vite:preloadError", onPreloadError);

  // Stops checking (tests).
  return () => {
    stopped = true;
    if (interval !== undefined) env.window.clearInterval(interval);
    env.window.removeEventListener("focus", onFocus);
    env.window.document.removeEventListener("visibilitychange", onFocus);
    env.window.removeEventListener("hashchange", onNavigate);
    env.window.removeEventListener("vite:preloadError", onPreloadError);
  };
}

const CHUNK_ERROR =
  /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|is not a valid JavaScript MIME type/i;

// A failed lazy import (the chunk no longer exists after a deploy).
export const isChunkLoadError = (error: unknown) =>
  error instanceof Error && (CHUNK_ERROR.test(error.message) || error.name === "ChunkLoadError");

// Reloads the app once for a stale chunk. Returns false when it already did so
// in the last minute, so the error shows instead of reloading in a loop.
export function reloadForStaleChunk(overrides: Partial<Pick<Env, "window" | "now" | "reload">> = {}): boolean {
  const win = overrides.window ?? window;
  const now = (overrides.now ?? Date.now)();
  const reload = overrides.reload ?? (() => win.location.reload());
  let last = 0;
  try {
    last = Number(win.sessionStorage.getItem(CHUNK_RELOAD_KEY) ?? 0);
  } catch {
    // Storage blocked: reload once anyway.
  }
  if (last && now - last < CHUNK_RELOAD_WINDOW_MS) return false;
  try {
    win.sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now));
  } catch {
    // Storage blocked.
  }
  reload();
  return true;
}

// Tests only.
export const resetAppUpdates = () => {
  waiting = false;
  applyUpdate = () => undefined;
  listeners.clear();
};
