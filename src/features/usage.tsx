import { useEffect, useState, type FormEvent } from "react";
import { Block, PageGrid } from "../app/page-grid";
import { z } from "zod";
import { useResource } from "../app/useResource";
import { PageHeader, Section } from "../components/shared";
import { request } from "../services/core";
import { settingsApi, useBusinessSettings } from "../services/settings";
import { usePermissions } from "../app/permissions";
import { T } from "../app/copy";

const rowSchema = z.object({ metric: z.string(), label: z.string(), value: z.number(),
  limit: z.number(), period: z.string(), percent: z.number().nullable() });
const labels = {
  workerRequests: "Worker requests per day", dbQueries: "Database queries per day",
  r2Bytes: "R2 storage bytes", supabaseBytes: "Supabase database bytes",
  githubMinutes: "GitHub Actions minutes per month",
} as const;
const format = (metric: string, value: number) =>
  metric.endsWith("bytes") ? `${(value / 1024 ** 2).toFixed(1)} MB` : value.toLocaleString();

export function UsagePage({ embedded = false }: { embedded?: boolean } = {}) {
  const manage = usePermissions().can("settings.manage");
  const settings = useBusinessSettings();
  const [revision, setRevision] = useState(0);
  const [draft, setDraft] = useState(settings.defaults.freeTierLimits);
  const [message, setMessage] = useState("");
  useEffect(() => setDraft(settings.defaults.freeTierLimits), [settings.defaults]);
  const usage = useResource(["free-tier-usage", revision], () =>
    request(rowSchema.array(), "/api/admin/usage"));
  const save = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await settingsApi.saveDefaults({ ...settings.defaults, freeTierLimits: draft });
      setMessage("Limits saved."); setRevision((value) => value + 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Unable to save limits."); }
  };
  return <>
    {embedded ? <h2><T id="usage.usage-page.free-tier-usage">Free-tier usage</T></h2> :
      <PageHeader pageKey="settings.usage" title={<T id="usage.usage-page.free-tier-usage">Free-tier usage</T>} subtitle={<T id="usage.usage-page.approximate-current-usage-and-configurable">Approximate current usage and configurable warning levels.</T>} />}
    <PageGrid pageKey="settings.usage">
    <Block id="current-usage" name="Current usage" h={10}>
    <Section title={<T id="usage.usage-page.current-usage">Current usage</T>}>
      {usage.error && <p role="alert"><T id="usage.usage-page.unable-to-load-usage">Unable to load usage.</T></p>}
      <ul>{usage.data?.map((row) => <li key={row.metric}>
        <strong>{row.label}</strong>: {format(row.metric, row.value)} / {format(row.metric, row.limit)}
        {row.percent !== null && ` (${row.percent}%)`} · {row.period}
      </li>)}</ul>
      <p><T id="usage.usage-page.worker-and-query-counts-are">Worker and query counts are approximate. R2 counts completed Flowbase attachments; GitHub minutes are reported by the ops workflow.</T></p>
    </Section>
    </Block>
    {manage && <Block id="limits" name="Free-tier limits" h={12}><Section title={<T id="usage.usage-page.free-tier-limits">Free-tier limits</T>}>
      <form onSubmit={(event) => void save(event)}>
        {Object.entries(labels).map(([key, label]) => <p key={key}><label>{label}{" "}
          <input type="number" min="1" step="1" value={draft[key as keyof typeof draft]}
            onChange={(event) => setDraft((current) => ({ ...current,
              [key]: Number(event.target.value) }))} />
        </label></p>)}
        <button type="submit"><T id="usage.usage-page.save-limits">Save limits</T></button>
      </form>
      {message && <p role="status">{message}</p>}
      <p><T id="usage.usage-page.sms-uses-the-monthly-cap">SMS uses the monthly cap in Settings → Defaults.</T></p>
    </Section></Block>}
    </PageGrid>
  </>;
}
