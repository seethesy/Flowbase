// When the collector may run (ADR-14): every 2 hours from 8am to 8pm New York time.
// GitHub cron is UTC, so the ops workflow fires every hour across both the EST and
// EDT windows, and a run that lands outside a slot exits before opening a browser.
const FIRST_HOUR = 8;
const LAST_HOUR = 20;

export function newYorkHour(now: Date) {
  const hour = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hourCycle: "h23",
  }).format(now);
  return Number(hour);
}

// 8am, 10am, … 8pm New York time.
export function isCollectionSlot(now: Date) {
  const hour = newYorkHour(now);
  return hour >= FIRST_HOUR && hour <= LAST_HOUR && (hour - FIRST_HOUR) % 2 === 0;
}
