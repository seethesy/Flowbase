import { test, expect } from "./auth-fixture";
import { juniper, fallGala } from "./fixtures";
import { seedRecords } from "./database";
import { businessTimeToUtc } from "../../shared/time";

for (const [date, startTime, endTime] of [
  ["2026-07-14", "18:00", "22:00"],
  ["2026-11-14", "18:00", "22:00"],
  ["2026-03-08", "01:30", "04:00"],
  ["2026-11-01", "01:30", "04:00"],
] as const) {
  test(`fixture and real event timestamps agree for New York ${date}`, async ({
    page,
  }) => {
    const event = { ...fallGala(), date, startTime, endTime };
    await seedRecords({ clients: [juniper()], events: [event] });
    await page.goto(`/#/events/${event.id}`);
    await expect(
      page.getByRole("heading", { name: event.title, level: 1 }),
    ).toBeVisible();
    const result = await page.evaluate(
      async ({ event, clientId }) => {
        const token = JSON.parse(
          localStorage.getItem("sb-test-auth-token")!,
        ).access_token;
        const headers = {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        };
        const seeded = await fetch(`/api/events/${event.id}`, { headers });
        const created = await fetch("/api/events", {
          method: "POST",
          headers,
          body: JSON.stringify({
            title: "Time contract event",
            date: event.date,
            startTime: event.startTime,
            endTime: event.endTime,
            clientId,
          }),
        });
        return {
          seeded: await seeded.json(),
          created: await created.json(),
          status: created.status,
        };
      },
      { event, clientId: juniper().id },
    );
    expect(result.status).toBe(201);
    expect(result.created.startsAt).toBe(
      businessTimeToUtc(date, startTime).toISOString(),
    );
    expect(result.seeded.startsAt).toBe(result.created.startsAt);
    expect(result.seeded.endsAt).toBe(result.created.endsAt);
    expect(result.created.startsAt).not.toBe(`${date}T${startTime}:00.000Z`);
  });
}
