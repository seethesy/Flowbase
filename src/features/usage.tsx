import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { useResource } from "../app/useResource";
import { PageHeader, Section } from "../components/shared";
import { request } from "../services/core";
import { settingsApi, useBusinessSettings } from "../services/settings";
import { usePermissions } from "../app/permissions";

const rowSchema = z.object({ metric: z.string(), label: z.string(), value: z.number(),
  limit: z.number(), period: z.string(), percent: z.number().nullable() });
const labels = {
  workerRequests: "Worker requests per day", dbQueries: "Database queries per day",
  r2Bytes: "R2 storage bytes", supabaseBytes: "Supabase database bytes",
  githubMinutes: "GitHub Actions minutes per month",
} as const;
const format = (metric: string, value: number) =>
  metric.endsWith("bytes") ? `${(value / 1024 ** 2).toFixed(1)} MB` : value.toLocaleString();

export function UsagePage() {
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
    <PageHeader title="Free-tier usage" subtitle="Approximate current usage and configurable warning levels." />
    <Section title="Current usage">
      {usage.error && <p role="alert">Unable to load usage.</p>}
      <ul>{usage.data?.map((row) => <li key={row.metric}>
        <strong>{row.label}</strong>: {format(row.metric, row.value)} / {format(row.metric, row.limit)}
        {row.percent !== null && ` (${row.percent}%)`} · {row.period}
      </li>)}</ul>
      <p>Worker and query counts are approximate. R2 counts completed Flowbase attachments; GitHub minutes are reported by the ops workflow.</p>
    </Section>
    {manage && <Section title="Free-tier limits">
      <form onSubmit={(event) => void save(event)}>
        {Object.entries(labels).map(([key, label]) => <p key={key}><label>{label}{" "}
          <input type="number" min="1" step="1" value={draft[key as keyof typeof draft]}
            onChange={(event) => setDraft((current) => ({ ...current,
              [key]: Number(event.target.value) }))} />
        </label></p>)}
        <button type="submit">Save limits</button>
      </form>
      {message && <p role="status">{message}</p>}
      <p>SMS uses the monthly cap in Settings → Defaults.</p>
    </Section>}
  </>;
}
