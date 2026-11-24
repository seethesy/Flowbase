import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FOCUS_CHECK_MS,
  FRESH_LOAD_MS,
  UPDATE_CHECK_MS,
  isChunkLoadError,
  reloadForStaleChunk,
  reloadToUpdate,
  resetAppUpdates,
  startAppUpdates,
  useUpdateWaiting,
  type RegisterSW,
} from "../../src/app/appUpdate";
import { hasUnsavedEdits, resetUnsavedEdits, useUnsavedEdits } from "../../src/app/unsavedEdits";

// New deployments reach open tabs and fresh loads (FLOW-325).
type Options = Parameters<RegisterSW>[0];
const stops: (() => void)[] = [];

function setup({ unsaved = false } = {}) {
  let options: Options = {};
  const updateSW = vi.fn(async () => undefined);
  const register: RegisterSW = (opts) => {
    options = opts;
    return updateSW;
  };
  const registration = { update: vi.fn(async () => undefined) } as unknown as ServiceWorkerRegistration;
  const reload = vi.fn();
  const state = { unsaved };
  stops.push(startAppUpdates(register, { reload, now: () => Date.now(), hasUnsavedEdits: () => state.unsaved }));
  options.onRegisteredSW?.("/sw.js", registration);
  return { options: () => options, updateSW, registration, reload, state };
}

function Waiting() {
  return <p>{useUpdateWaiting() ? "waiting" : "current"}</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
  resetAppUpdates();
  resetUnsavedEdits();
  sessionStorage.clear();
});
afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  vi.useRealTimers();
});

describe("app updates", () => {
  it("checks for a new version every few minutes and when the tab comes back", () => {
    const { registration } = setup();
    expect(registration.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(UPDATE_CHECK_MS);
    expect(registration.update).toHaveBeenCalledTimes(1);
    // A focus right after a check doesn't check again.
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(FOCUS_CHECK_MS);
    window.dispatchEvent(new Event("focus"));
    expect(registration.update).toHaveBeenCalledTimes(2);
  });

  it("applies a new version found right after the app opens (fresh load, new tab)", () => {
    const { options, updateSW } = setup();
    options().onNeedRefresh?.();
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it("later, shows the Reload notice instead of reloading, and Reload applies it", () => {
    const { options, updateSW, reload } = setup();
    render(<Waiting />);
    vi.advanceTimersByTime(FRESH_LOAD_MS + 1);
    act(() => options().onNeedRefresh?.());
    expect(screen.getByText("waiting")).toBeInTheDocument();
    expect(updateSW).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
    reloadToUpdate();
    expect(updateSW).toHaveBeenCalledWith(true);
    // The new worker takes over and the page reloads.
    options().onNeedReload?.();
    expect(reload).toHaveBeenCalled();
  });

  it("the next navigation picks up a waiting version, unless there are unsaved edits", () => {
    const { options, updateSW, state } = setup({ unsaved: true });
    // Unsaved edits right after opening: no automatic update.
    options().onNeedRefresh?.();
    expect(updateSW).not.toHaveBeenCalled();
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(updateSW).not.toHaveBeenCalled();
    state.unsaved = false;
    window.dispatchEvent(new HashChangeEvent("hashchange"));
    expect(updateSW).toHaveBeenCalledWith(true);
  });

  it("another tab's update doesn't reload a tab with unsaved edits", () => {
    const { options, reload } = setup({ unsaved: true });
    render(<Waiting />);
    act(() => options().onNeedReload?.());
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("waiting")).toBeInTheDocument();
  });

  it("reloads when the new worker took over elsewhere and nothing is unsaved", () => {
    const { options, reload } = setup();
    options().onNeedReload?.();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a stale lazy chunk reloads the app once, not in a loop", () => {
    const { reload } = setup();
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
    // A second failure straight after shows the error instead.
    const again = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(again);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(again.defaultPrevented).toBe(false);
  });

  it("recognises failed dynamic imports", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/assets/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Cannot read properties of undefined"))).toBe(false);
    const reload = vi.fn();
    expect(reloadForStaleChunk({ reload, now: () => 1_000_000 })).toBe(true);
    expect(reloadForStaleChunk({ reload, now: () => 1_000_000 + 1_000 })).toBe(false);
    expect(reloadForStaleChunk({ reload, now: () => 1_000_000 + 120_000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });
});

describe("unsaved edits", () => {
  function Dirty({ dirty }: { dirty: boolean }) {
    useUnsavedEdits(dirty);
    return null;
  }
  it("counts screens that say so, open dialogs and focused fields", () => {
    expect(hasUnsavedEdits()).toBe(false);
    const view = render(<Dirty dirty />);
    expect(hasUnsavedEdits()).toBe(true);
    view.rerender(<Dirty dirty={false} />);
    expect(hasUnsavedEdits()).toBe(false);
    view.unmount();

    const dialog = render(<div role="dialog" />);
    expect(hasUnsavedEdits()).toBe(true);
    dialog.unmount();

    render(<input aria-label="Name" />);
    screen.getByLabelText("Name").focus();
    expect(hasUnsavedEdits()).toBe(true);
  });
  it("renders without a window update state on the server", () => {
    expect(renderToStaticMarkup(<Waiting />)).toContain("current");
  });
});
