## Notifications

In-app and email notifications (FLOW-43, ADR-12; catalog in `shared/notifications.ts`, fan-out in `worker/notifications/fanout.ts`, API `worker/routes/notifications.ts`). Each notification type subscribes to one domain event through the job registry:

| Type | Domain event | Who is told |
| --- | --- | --- |
| `task_assigned` | `task.assigned` | People added as assignees, and people taken off ("Task reassigned", FLOW-60), except whoever made the change |
| `task_claimed` | `task.claimed` (FLOW-59) | Every active task manager except the claimant |
| `task_due_soon` | `task.due_soon` (FLOW-60) | The task's assignees, while it is still open |
| `task_due` | `task.due` | "Task overdue": the task's assignees and active managers, while it is still open |
| `task_completed` | `task.completed` (FLOW-60) | The task's active managers and creator, except whoever completed it |
| `staff_assigned` | `event.staff_assigned` (FLOW-140) | The person put on the roster slot |
| `approval_requested`, `approval_decided`, `inventory_conflict`, `production_alert`, `proposal_approved`, `payment_due`, `payment_overdue`, `collector_failure` | `approval.requested`, `approval.decided`, `inventory.conflict_detected`, `production.alert_raised`, `proposal.approved`, `payment.due`, `payment.overdue`, `collector.failed` | The producing module decides: its event's data carries `recipientIds`, `title`, `body` and an in-app `link` (`notifyPayloadSchema`). A payload without them fails the job so an admin sees it |

- **Exactly once (AC1):** each notification stores its event job's idempotency key, and `(source_key, user_id)` is unique, so a retried or reclaimed job notifies nobody twice. Only active staff are notified.
- **Email (AC2, AC3):** in-app is always on. Unless the person turned email off for that type (`notification_preferences`; no row means on), each notification queues its own `notification.email` job in the same transaction. That job sends through the `EmailProvider` interface (`worker/notifications/email.ts`; Resend's free tier, FLOW-33) with the job's key as Resend's `Idempotency-Key`, so a retry after a successful send emails nobody twice. A failed send logs `notification_email_failed` (no recipient address) and is retried by the jobs system with its usual backoff; preferences are checked again at send time. Without `EMAIL_API_KEY` and `EMAIL_FROM` emails are skipped and logged (`notification_email_skipped`), which is the case in dev and CI.
- **Urgent:** business settings mark types as urgent (Settings → Defaults, one checkbox per type); the SMS channel (FLOW-52) reads that flag.
- **In the app:** the header bell shows the unread count and the 50 newest notifications; opening one marks it read and goes to its record. The bell checks every minute while the page is visible, because the cron sends no "changed" ping. Reading notifications and changing preferences send no ping either (`worker/realtime.ts`). Email settings are on the profile page.

| Route | Purpose |
| --- | --- |
| `GET /api/notifications` | `{unreadCount, notifications}` for the caller |
| `POST /api/notifications/<id>/read`, `POST /api/notifications/read-all` | Mark one or all read |
| `GET /api/notifications/preferences`, `PUT …` `{email: {<type>: boolean}}` | Email on or off per type, with the urgent flag |

**Email setup (production, after FLOW-33):** `npx wrangler secret put EMAIL_API_KEY --env production` (the Resend API key), and set `EMAIL_FROM` (the verified sender, e.g. `Flowbase <notifications@notifications.eventsbydmvcater.com>`) as a production var in `wrangler.jsonc` or a secret. `APP_URL` must be set for emails to link into the app.
