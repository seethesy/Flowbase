import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "./shared";
import { useBusinessSettings } from "../services/settings";
import "../features/time-tracking.css";

// The idle cutoff is a business setting (FLOW-45).
export const trackingNoticeText = (idleMinutes: number) =>
  `Flowbase records how long you actively work on each screen, so the team can see the effort behind each booking and everyone's workload. Only time inside Flowbase counts: time stops when this tab is hidden or after ${idleMinutes} minutes without typing or clicking.`;

const NOTICE_KEY = "flowbase.trackingNoticeSeen";
const noticeSeen = () => {
  try {
    return window.localStorage.getItem(NOTICE_KEY) === "1";
  } catch {
    return false;
  }
};

// Shown on first use and remembered per browser.
export function TrackingNotice() {
  const [open, setOpen] = useState(() => !noticeSeen());
  const idleMinutes = useBusinessSettings().defaults.idleCutoffMinutes;
  if (!open) return null;
  return (
    <aside className="demo-callout tracking-notice" aria-label="Time tracking">
      <p>
        <strong>Time tracking is on.</strong> {trackingNoticeText(idleMinutes)}{" "}
        <Link to="/settings">More about time tracking</Link>
      </p>
      <Button
        variant="outline"
        onClick={() => {
          try {
            window.localStorage.setItem(NOTICE_KEY, "1");
          } catch {
            // Storage blocked: the notice just shows again next time.
          }
          setOpen(false);
        }}
      >
        Got it
      </Button>
    </aside>
  );
}

