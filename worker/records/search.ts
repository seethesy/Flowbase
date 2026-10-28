import { canSeeField } from "../../shared/visibility";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type Actor } from "../../shared/access";
import {
  SEARCH_MAX_LENGTH,
  SEARCH_MIN_LENGTH,
  searchResultPath,
  type SearchResult,
  type SearchResultType,
} from "../../shared/search";
import type { DbLike } from "../db/client";
import {
  clientContacts,
  clients,
  events,
  inventoryItems,
  leads,
  recipes,
  vendorContacts,
  vendors,
  venues,
} from "../db/schema";
import { can, clientScope, eventScope, leadScope } from "../policy";
import { recipeCategoryLabels } from "../../shared/recipes";
import { visibleClients } from "./clients";
import { visibleEvents } from "./events";
import { visibleLeads } from "./leads";
import { phoneDigits } from "./sync";

// Global search (FLOW-46, ADR-24): Postgres full-text search plus pg_trgm, so a
// name with a typo still matches. Each record type is queried with the caller's
// own visibility rule, and contact email and phone are matched only for users who
// may see them (FT+), so a result never reveals a record or field the caller can't
// open.

// word_similarity() is the share of the query's trigrams found in the best-matching
// part of the text: one typo in a name stays above this, unrelated words don't.
export const SEARCH_THRESHOLD = 0.4;
const PER_TYPE = 5;
const LIMIT = 20;

type Query = { text: string; like: string; digits: string };
type Text = AnyPgColumn | SQL;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

// How well a text column matches: a substring hit scores 1, a full-text hit 0.9,
// otherwise the trigram word similarity.
export const textScore = (column: Text, q: Pick<Query, "text" | "like">) => sql`
  greatest(
    word_similarity(${q.text}, ${column}),
    case when ${column} ilike ${q.like} then 1 else 0 end,
    case when to_tsvector('simple', ${column}) @@ plainto_tsquery('simple', ${q.text})
      then 0.9 else 0 end
  )`;
// Emails, codes and phone numbers match as typed (any part), never fuzzily.
const exactScore = (column: Text, q: Query) =>
  sql`case when ${column} ilike ${q.like} then 1 else 0 end`;
const phoneScore = (column: Text, q: Query) =>
  q.digits.length >= 4
    ? sql`case when ${column} like ${`%${q.digits}%`} then 1 else 0 end`
    : sql`0`;
const best = (...scores: SQL[]) => sql`greatest(${sql.join(scores, sql`, `)})`;

type Row = { id: string; title: string; subtitle: string; score: number };
const toNumber = (score: SQL) => sql<number>`(${score})::float8`;

async function searchClients(db: DbLike, actor: Actor, q: Query) {
  if (clientScope(actor) === "none") return [];
  const contactScore = best(
    textScore(clientContacts.name, q),
    ...(canSeeField(actor, "client_contact")
      ? [
          exactScore(clientContacts.email, q),
          phoneScore(clientContacts.phoneDigits, q),
        ]
      : []),
  );
  const score = best(
    textScore(clients.name, q),
    sql`coalesce((
      select max(${contactScore}) from ${clientContacts}
      where ${clientContacts.clientId} = ${clients.id}
        and ${clientContacts.archivedAt} is null
    ), 0)`,
  );
  return db
    .select({
      id: clients.id,
      title: clients.name,
      subtitle: sql<string>`case when ${clients.kind} = 'organization'
        then 'Organization' else 'Person' end`,
      score: toNumber(score),
    })
    .from(clients)
    .where(
      and(
        visibleClients(actor),
        isNull(clients.archivedAt),
        sql`${score} >= ${SEARCH_THRESHOLD}`,
      ),
    )
    .orderBy(desc(score))
    .limit(PER_TYPE);
}

async function searchLeads(db: DbLike, actor: Actor, q: Query) {
  if (leadScope(actor) === "none") return [];
  const score = best(
    textScore(leads.name, q),
    ...(canSeeField(actor, "lead_contact")
      ? [exactScore(leads.email, q), phoneScore(leads.phoneDigits, q)]
      : []),
  );
  return db
    .select({
      id: leads.id,
      title: sql<string>`case when ${leads.name} = '' then 'Unnamed lead'
        else ${leads.name} end`,
      subtitle: leads.source,
      score: toNumber(score),
    })
    .from(leads)
    .where(
      and(
        visibleLeads(actor),
        isNull(leads.archivedAt),
        sql`${score} >= ${SEARCH_THRESHOLD}`,
      ),
    )
    .orderBy(desc(score))
    .limit(PER_TYPE);
}

async function searchEvents(db: DbLike, actor: Actor, q: Query) {
  if (eventScope(actor) === "none") return [];
  const score = textScore(events.title, q);
  return db
    .select({
      id: events.id,
      title: events.title,
      subtitle: sql<string>`to_char(${events.startsAt} at time zone 'America/New_York',
        'Mon FMDD, YYYY')`,
      score: toNumber(score),
    })
    .from(events)
    .where(
      and(
        visibleEvents(actor),
        isNull(events.archivedAt),
        sql`${score} >= ${SEARCH_THRESHOLD}`,
      ),
    )
    .orderBy(desc(score))
    .limit(PER_TYPE);
}

// Venues and inventory items are visible to every signed-in user.
async function searchVenues(db: DbLike, q: Query) {
  const score = textScore(venues.name, q);
  return db
    .select({
      id: venues.id,
      title: venues.name,
      subtitle: venues.address,
      score: toNumber(score),
    })
    .from(venues)
    .where(and(isNull(venues.archivedAt), sql`${score} >= ${SEARCH_THRESHOLD}`))
    .orderBy(desc(score))
    .limit(PER_TYPE);
}

async function searchItems(db: DbLike, q: Query) {
  const score = best(
    textScore(inventoryItems.name, q),
    exactScore(inventoryItems.code, q),
  );
  return db
    .select({
      id: inventoryItems.id,
      title: inventoryItems.name,
      subtitle: inventoryItems.code,
      score: toNumber(score),
    })
    .from(inventoryItems)
    .where(
      and(
        isNull(inventoryItems.archivedAt),
        eq(inventoryItems.active, true),
        sql`${score} >= ${SEARCH_THRESHOLD}`,
      ),
    )
    .orderBy(desc(score))
    .limit(PER_TYPE);
}

// Vendors (FLOW-84) are visible to every signed-in user; their contacts are
// FT+ only, so only FT+ users match a vendor by a contact's name, email or phone.
async function searchVendors(db: DbLike, actor: Actor, q: Query) {
  const contactScore = best(
    textScore(vendorContacts.name, q),
    exactScore(vendorContacts.email, q),
    phoneScore(sql`regexp_replace(${vendorContacts.phone}, '\\D', '', 'g')`, q),
  );
  const score = best(
    textScore(vendors.name, q),
    ...(canSeeField(actor, "vendor_contact")
      ? [
          sql`coalesce((
            select max(${contactScore}) from ${vendorContacts}
            where ${vendorContacts.vendorId} = ${vendors.id}
              and ${vendorContacts.archivedAt} is null
          ), 0)`,
        ]
      : []),
  );
  return db
    .select({
      id: vendors.id,
      title: vendors.name,
      subtitle: sql<string>`case ${vendors.type}
        when 'food_distributor' then 'Food distributor'
        when 'beverage_distributor' then 'Beverage distributor'
        when 'rental_vendor' then 'Rental vendor'
        else 'Event partner' end`,
      score: toNumber(score),
    })
    .from(vendors)
    .where(and(isNull(vendors.archivedAt), sql`${score} >= ${SEARCH_THRESHOLD}`))
    .orderBy(desc(score))
    .limit(PER_TYPE);
}

// Recipes (FLOW-217): fuzzy dish names for anyone with recipes.read, live and
// active ones only, like inventory items. The category is the subtitle; no cost
// fields are returned.
async function searchRecipes(db: DbLike, actor: Actor, q: Query) {
  if (!can(actor, "recipes.read")) return [];
  const score = textScore(recipes.name, q);
  const rows = await db
    .select({
      id: recipes.id,
      title: recipes.name,
      category: recipes.category,
      score: toNumber(score),
    })
    .from(recipes)
    .where(
      and(
        isNull(recipes.archivedAt),
        eq(recipes.active, true),
        sql`${score} >= ${SEARCH_THRESHOLD}`,
      ),
    )
    .orderBy(desc(score))
    .limit(PER_TYPE);
  return rows.map(({ category, ...row }) => ({
    ...row,
    subtitle: recipeCategoryLabels[category],
  }));
}

// The best matches across every type the caller may see, best first. A query
// shorter than SEARCH_MIN_LENGTH returns nothing.
export async function globalSearch(
  db: DbLike,
  actor: Actor,
  rawQuery: string,
): Promise<SearchResult[]> {
  const text = rawQuery.trim().slice(0, SEARCH_MAX_LENGTH);
  if (text.length < SEARCH_MIN_LENGTH) return [];
  const q: Query = {
    text,
    like: `%${escapeLike(text)}%`,
    digits: /\d/.test(text) && !/[a-z@]/i.test(text) ? phoneDigits(text) : "",
  };
  const groups: [SearchResultType, Row[]][] = [
    ["client", await searchClients(db, actor, q)],
    ["lead", await searchLeads(db, actor, q)],
    ["event", await searchEvents(db, actor, q)],
    ["venue", await searchVenues(db, q)],
    ["item", await searchItems(db, q)],
    ["vendor", await searchVendors(db, actor, q)],
    ["recipe", await searchRecipes(db, actor, q)],
  ];
  return groups
    .flatMap(([type, rows]) =>
      rows.map((row) => ({
        type,
        id: row.id,
        title: row.title,
        subtitle: row.subtitle,
        path: searchResultPath(type, row.id),
        score: Number(row.score),
      })),
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, LIMIT);
}
