import { test, expect } from "./auth-fixture";
import { juniper, fallGala } from "./fixtures";
import { seedRecords } from "./database";
import { addLocalDays, businessTimeToUtc } from "../../shared/time";

for (const [date, startTime, endTime] of [
  ["2026-07-14", "18:00", "22:00"],
  ["2026-11-14", "18:00", "22:00"],
  ["2026-03-08", "01:30", "04:00"],
  ["2026-11-01", "01:30", "04:00"],
  ["2026-03-07", "23:00", "04:00"],
  ["2026-10-31", "23:00", "04:00"],
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
    expect(result.created.endsAt).toBe(
      businessTimeToUtc(
        endTime < startTime ? addLocalDays(date, 1) : date,
        endTime,
      ).toISOString(),
    );
    expect(result.created.startsAt).not.toBe(`${date}T${startTime}:00.000Z`);
  });
}

for (const [date, startTime, endTime] of [
  ["2026-03-08", "02:30", "04:00"],
  ["2026-03-07", "23:00", "02:30"],
] as const) {
  test(`fixture and real contract reject skipped New York time ${date} ${startTime}–${endTime}`, async ({
    page,
  }) => {
    await seedRecords({ clients: [juniper()] });
    await expect(
      seedRecords({ events: [{ ...fallGala(), date, startTime, endTime }] }),
    ).rejects.toThrow("doesn't exist");
    await page.goto(`/#/clients/${juniper().id}`);
    await expect(
      page.getByRole("heading", { name: juniper().name, level: 1 }),
    ).toBeVisible();
    const result = await page.evaluate(
      async (input) => {
        const token = JSON.parse(
          localStorage.getItem("sb-test-auth-token")!,
        ).access_token;
        const response = await fetch("/api/events", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        });
        return { status: response.status, body: await response.json() };
      },
      {
        title: "Skipped time",
        date,
        startTime,
        endTime,
        clientId: juniper().id,
      },
    );
    expect(result.status).toBe(400);
    expect(result.body.error.code).toBe("INVALID_REQUEST");
  });
}
