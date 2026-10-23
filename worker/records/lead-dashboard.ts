import { and, avg, desc, eq, gte, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";
import type { Actor } from "../../shared/access";
import type { LeadDashboard, LeadDashboardRow } from "../../shared/leads";
import { businessTimeToUtc, utcToBusinessTime } from "../../shared/time";
import type { DbLike } from "../db/client";
import { events, leads } from "../db/schema";
import { ApiError, forbidden } from "../hono";
import { leadScope } from "../policy";
import { visibleLeads } from "./leads";

// Lead dashboard (FLOW-113): leads by source, channel, status and salesperson over a
// range of received dates, with conversion, estimated closed value, median first
// response and leads awaiting action. Admin, Technical and the Sales Manager see
// everyone's numbers; a salesperson sees only their own leads (visibleLeads).
// Merged-away leads are archived and not counted twice.
const DEFAULT_DAYS = 30;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const addDays = (date: string, days: number) => {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
};
// Checks the pattern first: addDays can't parse anything else.
const validDate = (value: string) =>
  datePattern.test(value) && addDays(value, 0) === value;

// Events at Closed (paid and signed) or a later stage count as closed business.
const isClosed = sql`${events.status} in ('closed', 'preparation', 'finished')`;
const count = (condition?: SQL) =>
  condition
    ? sql<number>`(count(*) filter (where ${condition}))::int`
    : sql<number>`count(*)::int`;

const aggregates = (averageBudgetCents: number) => ({
  leads: count(),
  converted: count(sql`${leads.status} = 'converted'`),
  closed: count(isClosed),
  estimatedClosedCents: sql<number>`coalesce(
    (sum(coalesce(${leads.budgetCents}, ${averageBudgetCents}::int)) filter (where ${isClosed})),
    0)::float8`,
  medianFirstResponseSeconds: sql<number | null>`(percentile_cont(0.5) within group (
    order by extract(epoch from ${leads.firstRespondedAt} - ${leads.receivedAt}))
    filter (where ${leads.firstRespondedAt} is not null))::float8`,
  awaitingAction: count(sql`${leads.status} = 'new'`),
  purchased: count(sql`${leads.purchased}`),
});

type Aggregate = {
  leads: number;
  converted: number;
  closed: number;
  estimatedClosedCents: number;
  medianFirstResponseSeconds: number | null;
  awaitingAction: number;
  purchased: number;
};
const toRow = (row: Aggregate): LeadDashboardRow => ({
  leads: Number(row.leads),
  converted: Number(row.converted),
  conversionRate: Number(row.leads) ? Number(row.converted) / Number(row.leads) : null,
  closed: Number(row.closed),
  estimatedClosedCents: Math.round(Number(row.estimatedClosedCents)),
  medianFirstResponseSeconds:
    row.medianFirstResponseSeconds === null
      ? null
      : Math.round(Number(row.medianFirstResponseSeconds)),
  awaitingAction: Number(row.awaitingAction),
  purchased: Number(row.purchased),
});

export async function leadDashboard(
  db: DbLike,
  actor: Actor,
  range: { from?: string; to?: string },
  now = new Date(),
): Promise<LeadDashboard> {
  const scope = leadScope(actor);
  if (scope === "none" || scope === "staffed") throw forbidden();
  const invalid = () => new ApiError(400, "INVALID_REQUEST", "Enter a valid date range.");
  const to = range.to ?? utcToBusinessTime(now).date;
  if (!validDate(to)) throw invalid();
  const from = range.from ?? addDays(to, -(DEFAULT_DAYS - 1));
  if (!validDate(from) || from > to) throw invalid();
  const where = and(
    visibleLeads(actor),
    isNull(leads.archivedAt),
    gte(leads.receivedAt, businessTimeToUtc(from, "00:00")),
    lt(leads.receivedAt, businessTimeToUtc(addDays(to, 1), "00:00")),
  );

  const [budget] = await db
    .select({ average: avg(leads.budgetCents) })
    .from(leads)
    .where(and(where, isNotNull(leads.budgetCents)));
  const averageBudgetCents =
    budget?.average === null || budget?.average === undefined
      ? null
      : Math.round(Number(budget.average));
  const columns = aggregates(averageBudgetCents ?? 0);
  const base = () =>
    db.select(columns).from(leads).leftJoin(events, eq(leads.convertedEventId, events.id));

  const [totals] = await base().where(where);
  const bySource = await db
    .select({
      ...columns,
      source: leads.source,
      hasPurchased: sql<boolean>`bool_or(${leads.purchased})`,
    })
    .from(leads)
    .leftJoin(events, eq(leads.convertedEventId, events.id))
    .where(where)
    .groupBy(leads.source)
    .orderBy(desc(count()), leads.source);
  const byChannel = await db
    .select({ ...columns, channel: leads.channel })
    .from(leads)
    .leftJoin(events, eq(leads.convertedEventId, events.id))
    .where(where)
    .groupBy(leads.channel)
    .orderBy(desc(count()));
  const byStatus = await db
    .select({ status: leads.status, leads: count() })
    .from(leads)
    .where(where)
    .groupBy(leads.status);
  const bySalesperson = await db
    .select({ ...columns, salespersonId: leads.assignedSalespersonId })
    .from(leads)
    .leftJoin(events, eq(leads.convertedEventId, events.id))
    .where(where)
    .groupBy(leads.assignedSalespersonId)
    .orderBy(desc(count()));

  return {
    from,
    to,
    scope,
    averageBudgetCents,
    totals: toRow(totals),
    bySource: bySource.map((row) => ({
      ...toRow(row),
      source: row.source,
      hasPurchased: Boolean(row.hasPurchased),
    })),
    byChannel: byChannel.map((row) => ({ ...toRow(row), channel: row.channel })),
    byStatus: byStatus.map((row) => ({ status: row.status, leads: Number(row.leads) })),
    bySalesperson: bySalesperson.map((row) => ({
      ...toRow(row),
      salespersonId: row.salespersonId,
    })),
  };
}
