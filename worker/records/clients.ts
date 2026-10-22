import {
  and,
  asc,
  eq,
  ilike,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { isFtPlus, type Actor } from "../../shared/access";
import {
  clientCreateSchema,
  clientInputSchema,
  type Client,
} from "../../shared/core-records";
import type { z } from "zod";
import type { Db, DbLike } from "../db/client";
import { clientContacts, clients } from "../db/schema";
import { ApiError, forbidden, notFound } from "../hono";
import { emitDomainEvent } from "../jobs/queue";
import { clientScope, type Scope } from "../policy";
import { phoneDigits, syncChildren } from "./sync";

type ClientRow = typeof clients.$inferSelect;
type ContactRow = typeof clientContacts.$inferSelect;
type ClientCreate = z.output<typeof clientCreateSchema>;
type ClientUpdate = z.output<typeof clientInputSchema>;
type ContactInput = ClientUpdate["contacts"][number];

// Clients the actor may see (FLOW-53): all for Admin, Technical and Sales Manager,
// their own for a salesperson, none for other roles.
export function visibleClients(actor: Actor): SQL | undefined {
  const scope = clientScope(actor);
  if (scope === "all") return undefined;
  if (scope === "own") return eq(clients.assignedSalespersonId, actor.userId);
  return sql`false`;
}

export function requireClientAccess(actor: Actor): Scope {
  const scope = clientScope(actor);
  if (scope === "none") throw forbidden();
  return scope;
}

const toContact = (row: ContactRow, actor: Actor) => {
  const visible = isFtPlus(actor);
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    email: visible ? row.email : null,
    phone: visible ? row.phone : null,
    notes: row.notes,
  };
};

async function toClients(db: DbLike, actor: Actor, rows: ClientRow[]) {
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const contacts = await db
    .select()
    .from(clientContacts)
    .where(
      and(inArray(clientContacts.clientId, ids), isNull(clientContacts.archivedAt)),
    )
    .orderBy(asc(clientContacts.sortOrder));
  const showDuplicates = clientScope(actor) === "all";
  const duplicateIds = rows
    .map((row) => row.possibleDuplicateOfId)
    .filter((id): id is string => Boolean(id));
  const duplicates =
    showDuplicates && duplicateIds.length
      ? await db
          .select({ id: clients.id, name: clients.name })
          .from(clients)
          .where(inArray(clients.id, duplicateIds))
      : [];
  return rows.map(
    (row): Client => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      assignedSalespersonId: row.assignedSalespersonId,
      notes: row.notes,
      tags: row.tags,
      contacts: contacts
        .filter((contact) => contact.clientId === row.id)
        .map((contact) => toContact(contact, actor)),
      possibleDuplicateOf:
        duplicates.find((duplicate) => duplicate.id === row.possibleDuplicateOfId) ??
        null,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }),
  );
}

export async function listClients(
  db: Db,
  actor: Actor,
  filter: { archived?: boolean; search?: string; flagged?: boolean },
): Promise<Client[]> {
  const scope = requireClientAccess(actor);
  const rows = await db
    .select()
    .from(clients)
    .where(
      and(
        visibleClients(actor),
        filter.archived ? isNotNull(clients.archivedAt) : isNull(clients.archivedAt),
        filter.search ? ilike(clients.name, `%${filter.search}%`) : undefined,
        filter.flagged && scope === "all"
          ? isNotNull(clients.possibleDuplicateOfId)
          : undefined,
      ),
    )
    .orderBy(asc(clients.name))
    .limit(500);
  return toClients(db, actor, rows);
}

// A client the actor may see, archived or not; otherwise 404, never 403.
export async function findVisibleClient(db: DbLike, actor: Actor, id: string) {
  requireClientAccess(actor);
  const [row] = await db
    .select()
    .from(clients)
    .where(and(eq(clients.id, id), visibleClients(actor)));
  if (!row) throw notFound("Client");
  return row;
}

export async function getClient(db: Db, actor: Actor, id: string) {
  const [client] = await toClients(db, actor, [
    await findVisibleClient(db, actor, id),
  ]);
  return client;
}

// Clients whose live contacts share an email or phone with the new contacts.
async function findDuplicates(db: DbLike, contacts: ContactInput[]) {
  const emails = contacts
    .map((contact) => contact.email?.toLowerCase())
    .filter((email): email is string => Boolean(email));
  const phones = contacts
    .map((contact) => phoneDigits(contact.phone ?? ""))
    .filter((digits) => digits.length >= 7);
  if (!emails.length && !phones.length) return [];
  return db
    .selectDistinct({
      id: clients.id,
      name: clients.name,
      assignedSalespersonId: clients.assignedSalespersonId,
    })
    .from(clientContacts)
    .innerJoin(clients, eq(clientContacts.clientId, clients.id))
    .where(
      and(
        isNull(clientContacts.archivedAt),
        or(
          emails.length
            ? inArray(sql`lower(${clientContacts.email})`, emails)
            : undefined,
          phones.length ? inArray(clientContacts.phoneDigits, phones) : undefined,
        ),
      ),
    );
}

const contactValues = (input: ContactInput, sortOrder: number) => ({
  name: input.name,
  role: input.role,
  notes: input.notes,
  sortOrder,
  ...(input.email !== undefined && { email: input.email }),
  ...(input.phone !== undefined && {
    phone: input.phone,
    phoneDigits: phoneDigits(input.phone),
  }),
});

async function syncContacts(
  tx: DbLike,
  clientId: string,
  inputs: ContactInput[],
) {
  const existing = await tx
    .select({ id: clientContacts.id })
    .from(clientContacts)
    .where(
      and(eq(clientContacts.clientId, clientId), isNull(clientContacts.archivedAt)),
    );
  await syncChildren(
    existing.map((row) => row.id),
    inputs,
    {
      insert: (input, sortOrder) =>
        tx.insert(clientContacts).values({
          clientId,
          ...contactValues(input, sortOrder),
        }),
      update: (id, input, sortOrder) =>
        tx
          .update(clientContacts)
          .set(contactValues(input, sortOrder))
          .where(eq(clientContacts.id, id)),
      archive: (ids) =>
        tx
          .update(clientContacts)
          .set({ archivedAt: new Date() })
          .where(inArray(clientContacts.id, ids)),
    },
  );
}

export type ClientDuplicates = {
  visible: { id: string; name: string }[];
  hidden: { id: string; name: string }[];
};

// Matches for new contacts. Admin, Technical and Sales Manager see every match. A
// salesperson sees only their own clients; a match among clients they can't see is
// "hidden": flagged to Admin on the new client, never returned to them.
export async function checkDuplicates(
  db: DbLike,
  actor: Actor,
  scope: Scope,
  contacts: ContactInput[],
): Promise<ClientDuplicates> {
  const matches = await findDuplicates(db, contacts);
  const visible =
    scope === "all"
      ? matches
      : matches.filter((match) => match.assignedSalespersonId === actor.userId);
  const hidden = matches.filter((match) => !visible.includes(match));
  return {
    visible: visible.map(({ id, name }) => ({ id, name })),
    hidden: hidden.map(({ id, name }) => ({ id, name })),
  };
}

export const duplicateClientError = (duplicates: ClientDuplicates["visible"]) =>
  new ApiError(
    409,
    "POSSIBLE_DUPLICATE",
    "A client with this email or phone already exists.",
    { duplicates },
  );

// Inserts the client, its contacts and the client events inside the caller's
// transaction; returns the new id.
export async function insertClient(
  tx: DbLike,
  actor: Actor,
  scope: Scope,
  input: Pick<
    ClientCreate,
    "name" | "kind" | "notes" | "tags" | "contacts" | "assignedSalespersonId"
  >,
  hidden: ClientDuplicates["hidden"],
): Promise<string> {
  const [row] = await tx
    .insert(clients)
    .values({
      name: input.name,
      kind: input.kind,
      notes: input.notes,
      tags: input.tags,
      assignedSalespersonId:
        scope === "own" ? actor.userId : (input.assignedSalespersonId ?? null),
      possibleDuplicateOfId: hidden[0]?.id ?? null,
      createdBy: actor.userId,
      updatedBy: actor.userId,
    })
    .returning({ id: clients.id });
  await syncContacts(tx, row.id, input.contacts);
  await emitDomainEvent(tx, { name: "client.created", entityId: row.id });
  if (hidden.length)
    await emitDomainEvent(tx, {
      name: "client.duplicate_flagged",
      entityId: row.id,
      data: { possibleDuplicateOfIds: hidden.map((match) => match.id) },
    });
  return row.id;
}

// Creates a client. A matching email or phone warns Admin and Sales Manager (409
// with the matches). A salesperson is warned only about their own clients; a match
// among clients they can't see is flagged to Admin instead, and nothing about it
// is returned to them.
export async function createClient(
  db: Db,
  actor: Actor,
  input: ClientCreate,
): Promise<Client> {
  const scope = requireClientAccess(actor);
  const { visible, hidden } = await checkDuplicates(
    db,
    actor,
    scope,
    input.contacts,
  );
  if (visible.length && !input.allowDuplicate) throw duplicateClientError(visible);
  const id = await db.transaction((tx) =>
    insertClient(tx, actor, scope, input, hidden),
  );
  return getClient(db, actor, id);
}

export async function updateClient(
  db: Db,
  actor: Actor,
  id: string,
  input: ClientUpdate,
): Promise<Client> {
  const scope = requireClientAccess(actor);
  const current = await findVisibleClient(db, actor, id);
  await db.transaction(async (tx) => {
    await tx
      .update(clients)
      .set({
        name: input.name,
        kind: input.kind,
        notes: input.notes,
        tags: input.tags,
        // Only managers reassign; a salesperson keeps the client on themself.
        assignedSalespersonId:
          scope === "all" && input.assignedSalespersonId !== undefined
            ? input.assignedSalespersonId
            : current.assignedSalespersonId,
        updatedBy: actor.userId,
      })
      .where(eq(clients.id, id));
    await syncContacts(tx, id, input.contacts);
    await emitDomainEvent(tx, { name: "client.updated", entityId: id });
  });
  return getClient(db, actor, id);
}

export async function setClientArchived(
  db: Db,
  actor: Actor,
  id: string,
  archived: boolean,
): Promise<Client> {
  await findVisibleClient(db, actor, id);
  await db.transaction(async (tx) => {
    await tx
      .update(clients)
      .set({ archivedAt: archived ? new Date() : null, updatedBy: actor.userId })
      .where(eq(clients.id, id));
    await emitDomainEvent(tx, {
      name: archived ? "client.archived" : "client.restored",
      entityId: id,
    });
  });
  return getClient(db, actor, id);
}
