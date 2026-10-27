// @vitest-environment node
import { expect, it, vi } from "vitest";
import {
  EmailSendError,
  emailProviderFromEnv,
  notificationEmail,
  resendProvider,
} from "../../worker/notifications/email";
import { appPathSchema, notifyPayloadSchema } from "../../shared/notifications";

// The notification email provider (FLOW-43): Resend behind the EmailProvider
// interface, and the email built from a notification.

const message = {
  to: "casey@example.com",
  subject: "Task assigned: Order ice",
  text: "Due tomorrow",
  html: "<p>Due tomorrow</p>",
  idempotencyKey: "notification.email:6f1c",
};

it("sends through Resend's API with the key, sender and an idempotency key", async () => {
  const send = vi.fn<typeof fetch>(async () => new Response('{"id":"e-1"}', { status: 200 }));
  await resendProvider({ apiKey: "re_test", from: "Flowbase <n@example.com>" }, send).send(message);
  expect(send).toHaveBeenCalledTimes(1);
  const [url, init] = send.mock.calls[0];
  expect(url).toBe("https://api.resend.com/emails");
  expect(init?.method).toBe("POST");
  expect(init?.headers).toMatchObject({
    Authorization: "Bearer re_test",
    "Content-Type": "application/json",
    "Idempotency-Key": "notification.email:6f1c",
  });
  expect(JSON.parse(String(init?.body))).toEqual({
    from: "Flowbase <n@example.com>",
    to: ["casey@example.com"],
    subject: "Task assigned: Order ice",
    text: "Due tomorrow",
    html: "<p>Due tomorrow</p>",
  });
});

it("throws with the provider's status so the job is retried", async () => {
  const send = vi.fn<typeof fetch>(
    async () => new Response('{"message":"domain not verified"}', { status: 403 }),
  );
  const failure = resendProvider({ apiKey: "re_test", from: "n@example.com" }, send).send(message);
  await expect(failure).rejects.toBeInstanceOf(EmailSendError);
  await expect(failure).rejects.toMatchObject({ status: 403 });
  await expect(failure).rejects.toThrow("domain not verified");
});

it("is configured only with both the API key and the sender", () => {
  expect(emailProviderFromEnv(undefined)).toBeUndefined();
  expect(emailProviderFromEnv({ EMAIL_API_KEY: "re_test" })).toBeUndefined();
  expect(emailProviderFromEnv({ EMAIL_FROM: "n@example.com" })).toBeUndefined();
  expect(
    emailProviderFromEnv({ EMAIL_API_KEY: "re_test", EMAIL_FROM: "n@example.com" })?.name,
  ).toBe("resend");
});

it("builds the email with a hash-route link into the app and escaped HTML", () => {
  const email = notificationEmail(
    { title: "Task <b>due</b>", body: "Bring \"extra\" ice & lemons", link: "/tasks/t-1" },
    "https://flowbase.example/",
  );
  expect(email.subject).toBe("Task <b>due</b>");
  expect(email.text).toContain("Open in Flowbase: https://flowbase.example/#/tasks/t-1");
  expect(email.text).toContain("turn off emails");
  expect(email.html).toContain("Task &lt;b&gt;due&lt;/b&gt;");
  expect(email.html).toContain("Bring &quot;extra&quot; ice &amp; lemons");
  expect(email.html).toContain('href="https://flowbase.example/#/tasks/t-1"');
  // Without APP_URL there is no link.
  expect(notificationEmail({ title: "T", body: "", link: null }, undefined).text).not.toContain(
    "Open in Flowbase",
  );
});

it("accepts only in-app paths as notification links", () => {
  expect(appPathSchema.safeParse("/events/e-1").success).toBe(true);
  expect(appPathSchema.safeParse("/inventory?status=Alerts").success).toBe(true);
  for (const link of ["https://evil.example", "//evil.example", "javascript:alert(1)", "events"])
    expect(appPathSchema.safeParse(link).success, link).toBe(false);
  expect(
    notifyPayloadSchema.safeParse({ recipientIds: [], title: "x", link: "https://evil.example" })
      .success,
  ).toBe(false);
});
