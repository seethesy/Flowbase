import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import {
  ActivityTracker,
  contextForPath,
  sendSessions,
} from "../services/time-tracking";
import { useBusinessSettings } from "../services/settings";

// How often the tracker checks for idleness and sends what's due; it still sends at
// most once a minute (FLOW-119).
const TICK_MS = 15_000;

// Tracks active time in this tab against the screen on show (FLOW-119).
export function useActivityTracking() {
  const { pathname } = useLocation();
  const tracker = useRef<ActivityTracker | null>(null);
  const closing = useRef(false);
  tracker.current ??= new ActivityTracker({
    now: () => Date.now(),
    send: (sessions) => sendSessions(sessions, closing.current),
    visible: document.visibilityState === "visible",
  });
  useEffect(() => {
    tracker.current!.setContext(contextForPath(pathname));
  }, [pathname]);
  const idleMinutes = useBusinessSettings().defaults.idleCutoffMinutes;
  useEffect(() => {
    tracker.current!.setIdleCutoff(idleMinutes * 60_000);
  }, [idleMinutes]);
  useEffect(() => {
    const current = tracker.current!;
    const onInput = () => current.input();
    const onVisibility = () => {
      current.setVisible(document.visibilityState === "visible");
      if (document.visibilityState === "hidden") void current.flush();
    };
    const onPageHide = () => {
      closing.current = true;
      current.setVisible(false);
      void current.flush();
    };
    const listen = { capture: true, passive: true };
    window.addEventListener("keydown", onInput, listen);
    window.addEventListener("pointerdown", onInput, listen);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    const timer = window.setInterval(() => void current.tick(), TICK_MS);
    return () => {
      window.removeEventListener("keydown", onInput, listen);
      window.removeEventListener("pointerdown", onInput, listen);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      window.clearInterval(timer);
    };
  }, []);
}
