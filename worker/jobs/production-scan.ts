// A write to an event or its tasks queues one production scan for the next cron
// tick (FLOW-307). The key names the 5-minute bucket the edit fell in, and the job
// waits for the bucket's end, so every edit before that tick shares one queued
// scan. A late tick cannot run a bucket's job early and leave later edits in
// the same bucket without a scan.
export const SCAN_BUCKET_MS = 5 * 60_000;

export function productionScanJob(eventId: string, now = new Date()) {
  const bucket = Math.floor(now.getTime() / SCAN_BUCKET_MS);
  return {
    type: "production.scan",
    payload: { eventId },
    idempotencyKey: `production.scan:${eventId}:${bucket}`,
    runAt: new Date((bucket + 1) * SCAN_BUCKET_MS),
  };
}
