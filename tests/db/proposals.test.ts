import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import * as schema from "../../worker/db/schema";
import { createApp } from "../../worker/app";
import type { RunWithDb } from "../../worker/hono";
import type { Actor, EmploymentType, Role } from "../../shared/access";
import type {
  Client,
  EventStatusChange,
  FlowEvent,
} from "../../shared/core-records";
import {
  docxExportHint,
  DOCX_TYPE,
  PDF_TYPE,
  type Proposal,
  type ProposalDetail,
  type ProposalUploadTicket,
} from "../../shared/proposals";

// Proposals through the real API and database: the record and its stages
// (FLOW-122) and immutable file versions (FLOW-123).

const url = process.env.DATABASE_URL;
if (!url)
  throw new Error("DATABASE_URL must point to the disposable CI Postgres service.");
const client = postgres(url, { max: 1 });
const db = drizzle(client, { schema });
const withDb: RunWithDb = (_env, run) => run(db);
// What has "arrived" in the bucket, standing in for the R2 binding.
const stored = new Map<string, number>();
const env = {
  ASSETS: { fetch },
  R2_ACCOUNT_ID: "acct",
  R2_BUCKET: "flowbase-files",
  R2_ACCESS_KEY_ID: "key",
  R2_SECRET_ACCESS_KEY: "secret",
  FILES: {
    head: async (key: string) =>
      stored.has(key) ? { size: stored.get(key) ?? 0 } : null,
  },
};

const people = {
  admin: "c1220000-0000-4000-8000-000000000001",
  sam: "c1220000-0000-4000-8000-000000000002",
  sue: "c1220000-0000-4000-8000-000000000003",
  kit: "c1220000-0000-4000-8000-000000000004",
};
const signedInAs = (
  userId: string,
  role: Role,
  employmentType: EmploymentType = "full_time",
) => {
  const actor: Actor = { userId, role, employmentType };
  const app = createApp({ withDb, resolveActor: async () => actor });
  const call = (method: string, path: string, body?: unknown) =>
    app.request(
      path,
      {
        method,
        ...(body !== undefined && {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
        }),
      },
      env,
    );
  const send = async <T>(
    method: string,
    path: string,
    body?: unknown,
    status = method === "POST" && !path.includes("/stage") && !path.endsWith("/complete")
      ? 201
      : 200,
  ) => {
    const response = await call(method, path, body);
    expect(response.status, await response.clone().text()).toBe(status);
    return (await response.json()) as T;
  };
  return { call, send };
};
const admin = signedInAs(people.admin, "admin");
const sam = signedInAs(people.sam, "salesperson");
const sue = signedInAs(people.sue, "salesperson");
const kit = signedInAs(people.kit, "kitchen_staff");

const tables = sql`truncate table consumable_allocations, event_requirements, reservation_conflicts, reservations, proposal_versions, proposal_stage_history, proposals, lead_duplicates, leads, audit_log, event_status_history, event_staff_slots, event_shifts, event_areas, events, venue_contacts, venue_areas, venues, client_contacts, clients, ingest_receipts, jobs`;
beforeAll(async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
});
beforeEach(async () => {
  stored.clear();
  await db.execute(tables);
});
afterAll(async () => {
  await db.execute(tables);
  await client.end();
});

const newEvent = async (title = "Fall gala") => {
  const juniper = await sam.send<Client>("POST", "/api/clients", {
    name: "Juniper & Co.",
    kind: "organization",
    contacts: [],
  });
  return sam.send<FlowEvent>("POST", "/api/events", {
    title,
    date: "2026-11-14",
    startTime: "18:00",
    clientId: juniper.id,
  });
};
const newProposal = (event: FlowEvent, title = "Gala dinner", as = sam) =>
  as.send<ProposalDetail>("POST", "/api/proposals", {
    eventId: event.id,
    title,
  });
const move = (proposal: { id: string }, stage: string, reason?: string, as = sam) =>
  as.call("POST", `/api/proposals/${proposal.id}/stage`, { stage, reason });
const jobTypes = async () =>
  (await db.select({ type: schema.jobs.type }).from(schema.jobs)).map(
    (row) => row.type,
  );

describe("proposal record and stages (FLOW-122)", () => {
  it("creates a proposal in Client communication for the event's salesperson", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    expect(proposal).toMatchObject({
      eventId: event.id,
      clientId: event.client.id,
      title: "Gala dinner",
      stage: "client_communication",
      assignedSalesperson: { id: people.sam },
      currentVersion: null,
      versions: [],
    });
    expect(proposal.history).toMatchObject([
      { from: null, to: "client_communication", manual: true },
    ]);
    // One or more proposals per event.
    await newProposal(event, "Cocktail option");
    const list = await sam.send<Proposal[]>(
      "GET",
      `/api/proposals?eventId=${event.id}`,
    );
    expect(list.map((row) => row.title)).toEqual(["Gala dinner", "Cocktail option"]);
    expect(await jobTypes()).toContain("event:proposal.created");
  });

  it("lets the salesperson move the manual stages, each audited and in the history", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    expect((await move(proposal, "menu_curation")).status).toBe(200);
    const moved = (await (await move(proposal, "revisions")).json()) as ProposalDetail;
    expect(moved.stage).toBe("revisions");
    expect(moved.history.map((change) => [change.from, change.to])).toEqual([
      ["menu_curation", "revisions"],
      ["client_communication", "menu_curation"],
      [null, "client_communication"],
    ]);
    expect(moved.history[0].actor).toMatchObject({ id: people.sam });
    // Back to an earlier manual stage is fine; staying put is not.
    expect((await move(proposal, "client_communication")).status).toBe(200);
    expect((await move(proposal, "client_communication")).status).toBe(409);
    const audit = await db
      .select()
      .from(schema.auditLog)
      .where(eq(schema.auditLog.entityId, proposal.id))
      .orderBy(schema.auditLog.createdAt);
    expect(audit.map((row) => row.action)).toEqual([
      "create",
      "update",
      "update",
      "update",
    ]);
    expect(audit[1].changes.stage).toEqual({
      before: "client_communication",
      after: "menu_curation",
    });
    const changed = await db
      .select({ payload: schema.jobs.payload })
      .from(schema.jobs)
      .where(sql`${schema.jobs.type} = 'event:proposal.stage_changed'`);
    expect(changed).toHaveLength(3);
  });

  // AC1
  it("never moves to Finalized, Approved, Sent or Signed by hand", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    for (const stage of ["finalized", "approved", "sent", "signed"]) {
      const response = await move(proposal, stage, "", admin);
      expect(response.status, stage).toBe(400);
      expect(((await response.json()) as { error: { message: string } }).error.message).toBe(
        "Finalized, Approved, Sent and Signed are set by uploading, approving, sending and booking the proposal, not by hand.",
      );
    }
    const [row] = await db.select().from(schema.proposals);
    expect(row.stage).toBe("client_communication");
  });

  // AC2
  it("needs a reason to mark a proposal lost and keeps Lost final", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    const missing = await move(proposal, "lost", "");
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as { error: { message: string } }).error.message).toBe(
      "Enter why the proposal was lost.",
    );
    const lost = (await (await move(proposal, "lost", "Went with another caterer")).json()) as ProposalDetail;
    expect(lost).toMatchObject({ stage: "lost", lostReason: "Went with another caterer" });
    expect(lost.history[0]).toMatchObject({
      from: "client_communication",
      to: "lost",
      reason: "Went with another caterer",
    });
    expect((await move(proposal, "revisions")).status).toBe(409);
  });

  // AC2
  it("moves the event to Lost only when its last open proposal is lost", async () => {
    const event = await newEvent();
    const first = await newProposal(event, "Plated");
    const second = await newProposal(event, "Buffet");
    await move(first, "lost", "Too expensive");
    expect(
      (await sam.send<FlowEvent>("GET", `/api/events/${event.id}`)).status,
    ).toBe("inquiry");
    await move(second, "lost", "Date fell through");
    expect(
      (await sam.send<FlowEvent>("GET", `/api/events/${event.id}`)).status,
    ).toBe("lost");
    const [change] = await sam.send<EventStatusChange[]>(
      "GET",
      `/api/events/${event.id}/status-history`,
    );
    expect(change).toMatchObject({
      from: "inquiry",
      to: "lost",
      manual: false,
      reason: 'Proposal "Buffet" was lost: Date fell through',
    });
    expect(await jobTypes()).toContain("event:event.lost");
  });

  it("leaves an event that is already Lost or Finished alone", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    await admin.send(
      "POST",
      `/api/events/${event.id}/status`,
      { status: "finished" },
      200,
    );
    expect((await move(proposal, "lost", "Cancelled after the event")).status).toBe(200);
    expect(
      (await sam.send<FlowEvent>("GET", `/api/events/${event.id}`)).status,
    ).toBe("finished");
  });

  it("shows proposals only to sales roles on events they can open", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    expect((await sue.call("GET", `/api/proposals/${proposal.id}`)).status).toBe(404);
    expect(
      (await sue.call("GET", `/api/proposals?eventId=${event.id}`)).status,
    ).toBe(404);
    expect((await move(proposal, "menu_curation", "", sue)).status).toBe(404);
    expect(
      (await sue.call("POST", "/api/proposals", { eventId: event.id, title: "Mine" }))
        .status,
    ).toBe(404);
    expect((await kit.call("GET", `/api/proposals/${proposal.id}`)).status).toBe(403);
    expect((await admin.call("GET", `/api/proposals/${proposal.id}`)).status).toBe(200);
  });

  it("assigns a salesperson's proposal to them and lets Admin pick anyone", async () => {
    const event = await newEvent();
    const mine = await sam.send<ProposalDetail>("POST", "/api/proposals", {
      eventId: event.id,
      title: "Mine",
      assignedSalespersonId: people.sue,
    });
    expect(mine.assignedSalesperson?.id).toBe(people.sam);
    const updated = await admin.send<ProposalDetail>("PUT", `/api/proposals/${mine.id}`, {
      title: "Plated dinner",
      notes: "Client wants a tasting.",
      assignedSalespersonId: people.sue,
    });
    expect(updated).toMatchObject({
      title: "Plated dinner",
      notes: "Client wants a tasting.",
      assignedSalesperson: { id: people.sue },
    });
  });
});

const docx = (fileName = "Gala proposal.docx", size = 48_000) => ({
  fileName,
  contentType: DOCX_TYPE,
  size,
});
const pdf = (fileName = "Gala proposal.pdf", size = 120_000) => ({
  fileName,
  contentType: PDF_TYPE,
  size,
});
// Pretends the browser PUT each file to its signed URL.
const arrive = (ticket: ProposalUploadTicket, sizes: Record<string, number>) => {
  for (const upload of ticket.uploads) {
    const key = decodeURIComponent(
      new URL(upload.url).pathname.replace("/flowbase-files/", ""),
    );
    stored.set(key, sizes[upload.name]);
  }
};
const upload = async (
  proposal: { id: string },
  files: { docx: ReturnType<typeof docx>; pdf?: ReturnType<typeof pdf> },
) => {
  const ticket = await sam.send<ProposalUploadTicket>(
    "POST",
    `/api/proposals/${proposal.id}/versions`,
    files,
  );
  arrive(ticket, { docx: files.docx.size, pdf: files.pdf?.size ?? 0 });
  return sam.send<ProposalDetail>(
    "POST",
    `/api/proposals/${proposal.id}/versions/${ticket.versionId}/complete`,
  );
};

describe("proposal file upload and versions (FLOW-123)", () => {
  // AC1
  it("numbers each upload, marks the newest current and keeps older ones downloadable", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    const first = await upload(proposal, { docx: docx(), pdf: pdf() });
    expect(first.stage).toBe("finalized");
    expect(first.currentVersion).toBe(1);
    expect(first.history[0]).toMatchObject({
      from: "client_communication",
      to: "finalized",
      manual: false,
      reason: "Version 1 uploaded",
      actor: { id: people.sam },
    });
    await move(proposal, "revisions");
    const second = await upload(proposal, { docx: docx("Gala proposal v2.docx") });
    expect(second.currentVersion).toBe(2);
    expect(
      second.versions.map((version) => [version.number, version.current]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
    const [, v1] = second.versions;
    expect(v1.docx.fileName).toBe("Gala proposal.docx");
    expect(v1.pdf?.fileName).toBe("Gala proposal.pdf");
    expect(new URL(v1.docx.url).searchParams.get("X-Amz-Expires")).toBe("300");
    expect(second.versions[0].pdf).toBeNull();
    expect(second.versions[0].uploadedBy).toMatchObject({ id: people.sam });
    expect(await jobTypes()).toContain("event:proposal.version_uploaded");
  });

  it("generates storage keys and completes only once every file has arrived", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    const ticket = await sam.send<ProposalUploadTicket>(
      "POST",
      `/api/proposals/${proposal.id}/versions`,
      { docx: docx("../../etc/passwd.docx"), pdf: pdf() },
    );
    expect(ticket.uploads.map((item) => item.name)).toEqual(["docx", "pdf"]);
    for (const item of ticket.uploads)
      expect(new URL(item.url).pathname).not.toContain("passwd");
    const complete = `/api/proposals/${proposal.id}/versions/${ticket.versionId}/complete`;
    arrive(ticket, { docx: 48_000, pdf: 0 });
    expect((await sam.call("POST", complete)).status).toBe(404);
    arrive(ticket, { docx: 48_000, pdf: 120_000 });
    expect((await sam.call("POST", complete)).status).toBe(200);
    expect((await sam.call("POST", complete)).status).toBe(409);
    // A pending upload that never completes takes no number.
    await sam.send("POST", `/api/proposals/${proposal.id}/versions`, { docx: docx() });
    const detail = await sam.send<ProposalDetail>("GET", `/api/proposals/${proposal.id}`);
    expect(detail.versions.map((version) => version.number)).toEqual([1]);
  });

  // AC2
  it("has no API that changes or deletes a version's files", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    const { versions } = await upload(proposal, { docx: docx() });
    const version = `/api/proposals/${proposal.id}/versions/${versions[0].id}`;
    for (const method of ["PUT", "PATCH", "DELETE"]) {
      expect((await admin.call(method, version, { docx: docx() })).status, method).toBe(404);
      expect((await admin.call(method, `${version}/docx`)).status, method).toBe(404);
    }
    expect((await admin.call("POST", `${version}/archive`)).status).toBe(404);
    // Attachments can't reach proposal files either.
    expect(
      (
        await admin.call(
          "GET",
          `/api/attachments?recordType=proposal&recordId=${proposal.id}`,
        )
      ).status,
    ).toBe(400);
    const [row] = await db.select().from(schema.proposalVersions);
    expect(row).toMatchObject({ number: 1, status: "ready" });
  });

  // AC3
  it("rejects a PDF-only upload with the Google Docs export hint", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    for (const body of [
      { pdf: pdf() },
      { docx: pdf() },
      { docx: { ...docx(), fileName: "Gala proposal.pdf" } },
      { docx: { ...docx(), contentType: "application/msword", fileName: "Gala.doc" } },
    ]) {
      const response = await sam.call(
        "POST",
        `/api/proposals/${proposal.id}/versions`,
        body,
      );
      expect(response.status).toBe(400);
      expect(
        ((await response.json()) as { error: { message: string } }).error.message,
      ).toBe(docxExportHint);
    }
    expect(await db.select().from(schema.proposalVersions)).toHaveLength(0);
  });

  it("takes no versions on a sent, signed or lost proposal", async () => {
    const event = await newEvent();
    const proposal = await newProposal(event);
    await move(proposal, "lost", "Client went quiet");
    const response = await sam.call(
      "POST",
      `/api/proposals/${proposal.id}/versions`,
      { docx: docx() },
    );
    expect(response.status).toBe(409);
  });
});
