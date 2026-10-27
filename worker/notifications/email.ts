import type { Bindings } from "../bindings";

// Outbound email for notifications (FLOW-43, ADR-12) behind a provider interface,
// so the provider can change without touching the notification code. The only
// implementation is Resend's free transactional tier (FLOW-43 A1), set up in
// FLOW-33: EMAIL_API_KEY is the Worker secret, EMAIL_FROM the verified sender.

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
  // Repeating a send with the same key sends nothing new (a retried job).
  idempotencyKey: string;
};

export type EmailProvider = {
  name: string;
  send: (message: EmailMessage) => Promise<void>;
};

export class EmailSendError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "EmailSendError";
    this.status = status;
  }
}

const RESEND_URL = "https://api.resend.com/emails";

// Resend's send-email API. Within 24 hours a request with the same
// Idempotency-Key returns the first result instead of sending again, so a job
// retried after the send succeeded doesn't email anyone twice.
export function resendProvider(
  config: { apiKey: string; from: string },
  send: typeof fetch = fetch,
): EmailProvider {
  return {
    name: "resend",
    async send(message) {
      const response = await send(RESEND_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Content-Type": "application/json",
          // Resend accepts 1–256 characters.
          "Idempotency-Key": message.idempotencyKey.slice(0, 256),
        },
        body: JSON.stringify({
          from: config.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });
      if (response.ok) return;
      // The error body names the problem (e.g. an unverified domain); it never
      // contains the recipient, so it is safe to log.
      const detail = await response.text().catch(() => "");
      throw new EmailSendError(
        response.status,
        `Email provider answered ${response.status}${detail ? `: ${detail.slice(0, 300)}` : ""}`,
      );
    },
  };
}

// The configured provider, or undefined when email isn't set up (dev, CI).
export function emailProviderFromEnv(
  env: Partial<Bindings> | undefined,
): EmailProvider | undefined {
  if (!env?.EMAIL_API_KEY || !env.EMAIL_FROM) return undefined;
  return resendProvider({ apiKey: env.EMAIL_API_KEY, from: env.EMAIL_FROM });
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

// A notification as an email: its title, body and a link into the app. The app
// uses hash routing, so a record's path follows "/#".
export function notificationEmail(
  notification: { title: string; body: string; link: string | null },
  appUrl: string | undefined,
) {
  const base = appUrl?.replace(/\/$/, "");
  const url = base ? `${base}/#${notification.link ?? "/"}` : null;
  const footer =
    "You can turn off emails for this kind of notification on your profile in Flowbase.";
  const lines = [notification.body, url ? `Open in Flowbase: ${url}` : ""];
  const text = [...lines.filter(Boolean), "", footer].join("\n");
  const html = [
    `<p><strong>${escapeHtml(notification.title)}</strong></p>`,
    notification.body ? `<p>${escapeHtml(notification.body)}</p>` : "",
    url ? `<p><a href="${escapeHtml(url)}">Open in Flowbase</a></p>` : "",
    `<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>`,
  ].join("");
  return { subject: notification.title, text, html };
}
