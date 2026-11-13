import { useState } from "react";
import { z } from "zod";
import { useResource } from "../app/useResource";
import { PageHeader, Section } from "../components/shared";
import { request } from "../services/core";
import { usePermissions } from "../app/permissions";

const runSchema = z.object({ at: z.string(), leadsFound: z.number(), status: z.string() });
const healthSchema = z.object({ site: z.string(), lastSuccessfulAt: z.string().nullable(),
  lastRunAt: z.string().nullable(), leadsFound: z.number().nullable(), status: z.string(),
  lastError: z.string().nullable(), noLeadsGapHours: z.number(), failureThreshold: z.number(),
  recentRuns: runSchema.array() });
const smsSchema = z.object({ id: z.string(), mobile: z.string(), body: z.string(),
  status: z.string(), provider: z.string(), createdAt: z.string() });
const instructions = "https://github.com/seethesy/Flowbase/blob/main/collector/README.md#ops-repo-setup";

export function CollectorHealthPage() {
  const manage = usePermissions().can("settings.manage");
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState("");
  const health = useResource(["collector-health", revision], () =>
    request(healthSchema.array(), "/api/admin/collector-health"));
  const sms = useResource(["sms-outbox", revision, manage], () =>
    manage ? request(smsSchema.array(), "/api/admin/sms-outbox") : Promise.resolve([]));
  const save = async (site: string, form: HTMLFormElement) => {
    const fields = new FormData(form);
    try {
      await request(z.object({ saved: z.boolean() }), `/api/admin/collector-health/${site}`, "PUT", {
        noLeadsGapHours: Number(fields.get("gap")), failureThreshold: Number(fields.get("failures")) });
      setError(""); setRevision((value) => value + 1);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save."); }
  };
  return <>
    <PageHeader title="Collector health" subtitle="Recent site runs and alert thresholds." />
    <p><a href={instructions} target="_blank" rel="noreferrer">Collector re-login and ops instructions</a></p>
    {manage && <p>Monitor a site before its first run: {(["bark", "perfect_venue", "weddingpro", "eventective"] as const)
      .filter((site) => !health.data?.some((row) => row.site === site))
      .map((site) => <button key={site} type="button" onClick={() => {
        void request(z.object({ saved: z.boolean() }), `/api/admin/collector-health/${site}`, "PUT",
          { noLeadsGapHours: 48, failureThreshold: 3 }).then(() => setRevision((v) => v + 1))
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to save."));
      }}>{site}</button>)}</p>}
    {error && <p role="alert">{error}</p>}
    {health.error && <p role="alert">Unable to load collector health.</p>}
    {health.data?.map((site) => <Section key={site.site} title={site.site}>
      <p>Status: <strong>{site.status.replaceAll("_", " ")}</strong> · Last successful run: {site.lastSuccessfulAt ?? "Never"} · Latest leads: {site.leadsFound ?? "—"}</p>
      {site.lastError && <p>Last error: {site.lastError}</p>}
      {manage && <form key={`${site.site}-${revision}`} onSubmit={(event) => { event.preventDefault(); void save(site.site, event.currentTarget); }}>
        <label>No-leads gap (hours) <input name="gap" type="number" min="1" max="720" defaultValue={site.noLeadsGapHours} /></label>{" "}
        <label>Failures before alert <input name="failures" type="number" min="1" max="20" defaultValue={site.failureThreshold} /></label>{" "}
        <button type="submit">Save</button>
      </form>}
      <ul>{site.recentRuns.map((run) => <li key={run.at}>{run.at}: {run.status}, {run.leadsFound} leads</li>)}</ul>
    </Section>)}
    {manage && <Section title="SMS outbox">
      <p>Stub messages are recorded here; no text is sent.</p>
      {sms.error && <p role="alert">Unable to load SMS outbox.</p>}
      <ul>{sms.data?.map((message) => <li key={message.id}>{message.createdAt} · {message.mobile} · {message.status} · {message.body}</li>)}</ul>
    </Section>}
  </>;
}
