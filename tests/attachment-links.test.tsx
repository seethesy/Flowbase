import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TestAuth } from "./auth-provider";
import { Attachments } from "../src/features/attachments";
import type { Attachment } from "../shared/attachments";

// FLOW-201: signed attachment links (five minutes, FLOW-42) are renewed while
// a record page stays open, without leaving the record.
const recordId = "a0000000-0000-4000-8000-0000000000c1";
const FIVE_MINUTES = 5 * 60_000;
let visibility: DocumentVisibilityState = "visible";
const setVisibility = (state: DocumentVisibilityState) => {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
};

// The list API: each response signs fresh links, numbered by response, that
// expire five minutes later. `allowed` false answers like a revoked reader.
let signed = 0;
let allowed = true;
const listCalls = () =>
  vi
    .mocked(fetch)
    .mock.calls.filter(([input]) => String(input).startsWith("/api/attachments"))
    .length;
const attachment = (
  id: string,
  group: string,
  kind: "photo" | "document",
): Attachment => ({
  id,
  recordType: "venue",
  recordId,
  group,
  fileName: kind === "photo" ? "plan.jpg" : "menu.pdf",
  caption: "",
  kind,
  urls:
    kind === "photo"
      ? {
          thumb: `https://r2.example/${id}/thumb?sig=${signed}`,
          display: `https://r2.example/${id}/display?sig=${signed}`,
        }
      : { original: `https://r2.example/${id}/original?sig=${signed}` },
  urlsExpireAt: new Date(Date.now() + FIVE_MINUTES).toISOString(),
  createdAt: "2026-10-22T09:00:00.000Z",
});
const photoId = "a0000000-0000-4000-8000-0000000000f1";
const documentId = "a0000000-0000-4000-8000-0000000000f2";

beforeEach(() => {
  signed = 0;
  allowed = true;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (!String(input).startsWith("/api/attachments"))
      return Response.json([]);
    if (!allowed)
      return Response.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "You don't have access to these files.",
            requestId: "req-1",
          },
        },
        { status: 403 },
      );
    signed += 1;
    return Response.json([
      attachment(photoId, "floor_plan", "photo"),
      attachment(documentId, "aerial", "document"),
    ]);
  });
});
afterEach(() => {
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

// A venue page shows two groups of the same record (floor plans, aerials).
const renderVenueFiles = () =>
  render(
    <TestAuth>
      <Attachments
        recordType="venue"
        recordId={recordId}
        group="floor_plan"
        title="Floor plans"
      />
      <Attachments
        recordType="venue"
        recordId={recordId}
        group="aerial"
        title="Aerial images"
      />
    </TestAuth>,
  );
const photoLink = () =>
  screen.getByRole("img", { name: "plan.jpg" }).closest("a")!;
const documentLink = () => screen.getByText("menu.pdf").closest("a")!;

it("renews links before they expire while the page stays open, once for every group", async () => {
  renderVenueFiles();
  await waitFor(() => expect(photoLink()).toHaveAttribute("href", expect.stringContaining("sig=1")));
  expect(listCalls()).toBe(1);

  await vi.advanceTimersByTimeAsync(FIVE_MINUTES - 60_000);
  expect(listCalls()).toBe(1);
  await vi.advanceTimersByTimeAsync(45_000);
  await waitFor(() =>
    expect(photoLink()).toHaveAttribute("href", expect.stringContaining("sig=2")),
  );
  expect(documentLink()).toHaveAttribute("href", expect.stringContaining("sig=2"));
  // Two groups, one renewal request.
  expect(listCalls()).toBe(2);
});

it("opens a fresh link instead of an expired one", async () => {
  const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
  const open = vi
    .spyOn(window, "open")
    .mockReturnValue(tab as unknown as Window);
  renderVenueFiles();
  await waitFor(() => expect(documentLink()).toBeInTheDocument());
  // The computer slept past expiry: the clock moved, no renewal ran.
  vi.setSystemTime(Date.now() + FIVE_MINUTES + 60_000);

  // Both groups clicked at once still renew once.
  const clicked = [
    fireEvent.click(documentLink()),
    fireEvent.click(photoLink()),
  ];
  // The default navigation to the expired link was cancelled.
  expect(clicked).toEqual([false, false]);
  await waitFor(() =>
    expect(tab.location.href).toMatch(/sig=2$/),
  );
  expect(listCalls()).toBe(2);
  expect(tab.opener).toBeNull();
  expect(open).toHaveBeenCalledWith("", "_blank");
  expect(tab.close).not.toHaveBeenCalled();
});

it("follows a link that is still valid without renewing", async () => {
  const open = vi.spyOn(window, "open");
  renderVenueFiles();
  await waitFor(() => expect(documentLink()).toBeInTheDocument());
  expect(fireEvent.click(documentLink())).toBe(true);
  expect(open).not.toHaveBeenCalled();
  expect(listCalls()).toBe(1);
});

it("reports lost access and exposes no link when renewal is refused", async () => {
  const tab = { opener: {}, location: { href: "" }, close: vi.fn() };
  vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
  renderVenueFiles();
  await waitFor(() => expect(documentLink()).toBeInTheDocument());
  allowed = false;
  vi.setSystemTime(Date.now() + FIVE_MINUTES + 60_000);
  fireEvent.click(documentLink());
  await waitFor(() => expect(tab.close).toHaveBeenCalled());
  expect(tab.location.href).toBe("");
  expect(
    (await screen.findAllByText(/You don't have access to these files/)).length,
  ).toBeGreaterThan(0);
  // The expired links are gone from the page, not left to be clicked.
  expect(screen.queryByText("menu.pdf")).not.toBeInTheDocument();
  expect(screen.queryByRole("img", { name: "plan.jpg" })).not.toBeInTheDocument();
});

it("does nothing while hidden and renews at once when shown after expiry", async () => {
  renderVenueFiles();
  await waitFor(() => expect(documentLink()).toBeInTheDocument());
  act(() => setVisibility("hidden"));
  await vi.advanceTimersByTimeAsync(FIVE_MINUTES * 3);
  expect(listCalls()).toBe(1);
  act(() => setVisibility("visible"));
  await waitFor(() =>
    expect(documentLink()).toHaveAttribute("href", expect.stringContaining("sig=2")),
  );
  expect(listCalls()).toBe(2);
});

it("stops renewing after the record page closes", async () => {
  const page = renderVenueFiles();
  await waitFor(() => expect(documentLink()).toBeInTheDocument());
  page.unmount();
  await vi.advanceTimersByTimeAsync(FIVE_MINUTES * 3);
  expect(listCalls()).toBe(1);
});
