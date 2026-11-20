import { TestAuth } from "./auth-provider";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { expect, it, vi } from "vitest";
import {
  NotificationBell,
  NotificationSettings,
} from "../src/features/notifications";
import type {
  Notification,
  NotificationInbox,
  NotificationPreference,
} from "../shared/notifications";

// Notification center and email settings (FLOW-43).
const at = "2026-10-27T14:00:00.000Z";
const taskId = "7a000000-0000-4000-8000-000000000001";
const assigned: Notification = {
  id: "4a000000-0000-4000-8000-000000000001",
  type: "task_assigned",
  title: "Task assigned: Order ice",
  body: "Due 2026-10-28 15:00",
  link: `/tasks/${taskId}`,
  readAt: null,
  createdAt: at,
};
const older: Notification = {
  ...assigned,
  id: "4a000000-0000-4000-8000-000000000002",
  title: "Approval requested",
  body: "",
  link: null,
  readAt: at,
};

function mountBell() {
  let inbox: NotificationInbox = { unreadCount: 1, notifications: [assigned, older] };
  const read: string[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input);
    if (path === "/api/notifications" && (init?.method ?? "GET") === "GET")
      return Response.json(inbox);
    const marked = path.match(/^\/api\/notifications\/([^/]+)\/read$/);
    if (marked && init?.method === "POST") {
      read.push(marked[1]);
      inbox = {
        unreadCount: 0,
        notifications: [{ ...assigned, readAt: at }, older],
      };
      return Response.json({ ...assigned, readAt: at });
    }
    throw new Error(`Unexpected request ${init?.method ?? "GET"} ${path}`);
  });
  render(
    <TestAuth>
      <MemoryRouter initialEntries={["/"]}>
        <NotificationBell />
        <Routes>
          <Route path="/" element={<p>Dashboard</p>} />
          <Route path="/tasks/:id" element={<p>Task page</p>} />
        </Routes>
      </MemoryRouter>
    </TestAuth>,
  );
  return read;
}

it("shows the unread count, and opening a notification marks it read and goes to its record", async () => {
  const read = mountBell();
  const bell = await screen.findByRole("button", { name: "Notifications, 1 unread" });
  expect(bell).toHaveTextContent("1");
  fireEvent.click(bell);
  expect(await screen.findByText("Task assigned: Order ice")).toBeInTheDocument();
  expect(screen.getByText("Approval requested")).toBeInTheDocument();
  fireEvent.click(screen.getByText("Task assigned: Order ice"));
  expect(await screen.findByText("Task page")).toBeInTheDocument();
  expect(read).toEqual([assigned.id]);
  expect(
    await screen.findByRole("button", { name: "Notifications" }),
  ).not.toHaveTextContent("1");
});

it("shows no count when the notifications can't load", async () => {
  vi.mocked(fetch).mockImplementation(async () =>
    Response.json(
      { error: { code: "DATABASE_NOT_CONFIGURED", message: "The database is not configured.", requestId: "r-1" } },
      { status: 503 },
    ),
  );
  render(
    <TestAuth>
      <MemoryRouter>
        <NotificationBell />
      </MemoryRouter>
    </TestAuth>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Notifications" }));
  expect(await screen.findByText(/Notifications couldn't load/)).toBeInTheDocument();
});

it("saves email and SMS choices while in-app notifications stay on", async () => {
  const preferences: NotificationPreference[] = [
    {
      type: "task_assigned",
      label: "Task assigned",
      description: "A task is assigned to you.",
      email: true,
      sms: false,
      urgent: false,
    },
    {
      type: "collector_failure",
      label: "Lead collector failure",
      description: "The lead collector stopped collecting from a site.",
      email: true,
      sms: false,
      urgent: true,
    },
  ];
  const saved: unknown[] = [];
  vi.mocked(fetch).mockImplementation(async (input, init) => {
    const path = String(input);
    if (path !== "/api/notifications/preferences")
      throw new Error(`Unexpected request ${path}`);
    if (init?.method === "PUT") {
      const body = JSON.parse(String(init.body)) as { email: Record<string, boolean>; sms: Record<string, boolean> };
      saved.push(body);
      return Response.json(
        preferences.map((p) => ({ ...p, email: body.email[p.type] ?? p.email, sms: body.sms[p.type] ?? p.sms })),
      );
    }
    return Response.json(preferences);
  });
  render(
    <TestAuth>
      <MemoryRouter>
        <NotificationSettings />
      </MemoryRouter>
    </TestAuth>,
  );
  expect(
    await screen.findByText(/Notifications always appear in the app/),
  ).toBeInTheDocument();
  expect(screen.getByText("Urgent")).toBeInTheDocument();
  const box = screen.getByRole("checkbox", { name: /Task assigned EMAIL/ });
  expect(box).toBeChecked();
  fireEvent.click(box);
  fireEvent.click(screen.getByRole("button", { name: "Save notification settings" }));
  expect(await screen.findByText("Notification settings saved.")).toBeInTheDocument();
  expect(saved).toEqual([
    { email: { task_assigned: false, collector_failure: true }, sms: { task_assigned: false, collector_failure: false } },
  ]);
  await waitFor(() =>
    expect(screen.getByRole("checkbox", { name: /Task assigned EMAIL/ })).not.toBeChecked(),
  );
});
