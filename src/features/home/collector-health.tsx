import { Block, PageGrid } from "../../app/live-edit/page-grid";
import { useState } from "react";
import { z } from "zod";
import { useResource } from "../../app/useResource";
import { PageHeader, Section } from "../../components/shared";
import { request } from "../../services/core";
import { usePermissions } from "../../app/permissions";
import { T } from "../../app/copy";

const runSchema = z.object({ at: z.string(), leadsFound: z.number(), status: z.string() });
const healthSchema = z.object({ site: z.string(), lastSuccessfulAt: z.string().nullable(),
  lastRunAt: z.string().nullable(), leadsFound: z.number().nullable(), status: z.string(),
  lastError: z.string().nullable(), noLeadsGapHours: z.number(), failureThreshold: z.number(),
  recentRuns: runSchema.array() });
const smsSchema = z.object({ id: z.string(), mobile: z.string(), body: z.string(),
  status: z.string(), provider: z.string(), createdAt: z.string() });
const instructions = "https://github.com/seethesy/Flowbase/blob/main/collector/README.md#ops-repo-setup";

export function CollectorHealthPage({ embedded = false }: { embedded?: boolean } = {}) {
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
    {embedded ? <h2><T id="collector-health.collector-health-page.collector-health">Collector health</T></h2> :
      <PageHeader pageKey="settings.collector" title={<T id="collector-health.collector-health-page.collector-health">Collector health</T>} subtitle={<T id="collector-health.collector-health-page.recent-site-runs-and-alert">Recent site runs and alert thresholds.</T>} />}
    <PageGrid pageKey="settings.collector">
    <Block id="monitoring" name="Collector monitoring" h={5}>
    <p><a href={instructions} target="_blank" rel="noreferrer"><T id="collector-health.collector-health-page.collector-re-login-and-ops">Collector re-login and ops instructions</T></a></p>
    {manage && <p><T id="collector-health.collector-health-page.monitor-a-site-before-its">{"Monitor a site before its first run: "}</T>{(["bark", "perfect_venue", "weddingpro", "eventective"] as const)
      .filter((site) => !health.data?.some((row) => row.site === site))
      .map((site) => <button key={site} type="button" onClick={() => {
        void request(z.object({ saved: z.boolean() }), `/api/admin/collector-health/${site}`, "PUT",
          { noLeadsGapHours: 48, failureThreshold: 3 }).then(() => setRevision((v) => v + 1))
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Unable to save."));
      }}>{site}</button>)}</p>}
    </Block>
    <Block id="sites" name="Collector sites" h={16}>
    {error && <p role="alert">{error}</p>}
    {health.error && <p role="alert"><T id="collector-health.collector-health-page.unable-to-load-collector-health">Unable to load collector health.</T></p>}
    {health.data?.map((site) => <Section key={site.site} title={site.site}>
      <p><T id="collector-health.collector-health-page.status">{"Status: "}</T><strong>{site.status.replaceAll("_", " ")}</strong><T id="collector-health.collector-health-page.last-successful-run">{" · Last successful run: "}</T>{site.lastSuccessfulAt ?? <T id="collector-health.collector-health-page.never">Never</T>}<T id="collector-health.collector-health-page.latest-leads" values={{ value: site.leadsFound ?? "—" }}>{" · Latest leads: {value}"}</T></p>
      {site.lastError && <p><T id="collector-health.collector-health-page.last-error" values={{ lastError: site.lastError }}>{"Last error: {lastError}"}</T></p>}
      {manage && <form key={`${site.site}-${revision}`} onSubmit={(event) => { event.preventDefault(); void save(site.site, event.currentTarget); }}>
        <label><T id="collector-health.collector-health-page.no-leads-gap-hours">{"No-leads gap (hours) "}</T><input name="gap" type="number" min="1" max="720" defaultValue={site.noLeadsGapHours} /></label>{" "}
        <label><T id="collector-health.collector-health-page.failures-before-alert">{"Failures before alert "}</T><input name="failures" type="number" min="1" max="20" defaultValue={site.failureThreshold} /></label>{" "}
        <button type="submit"><T id="collector-health.collector-health-page.save">Save</T></button>
      </form>}
      <ul>{site.recentRuns.map((run) => <li key={run.at}><T id="collector-health.collector-health-page.leads" values={{ at: run.at, status: run.status, leadsFound: run.leadsFound }}>{"{at}: {status}, {leadsFound} leads"}</T></li>)}</ul>
    </Section>)}
    </Block>
    {manage && <Block id="sms" name="SMS outbox" h={10}><Section title={<T id="collector-health.collector-health-page.sms-outbox">SMS outbox</T>}>
      <p><T id="collector-health.collector-health-page.stub-messages-are-recorded-here">Stub messages are recorded here; no text is sent.</T></p>
      {sms.error && <p role="alert"><T id="collector-health.collector-health-page.unable-to-load-sms-outbox">Unable to load SMS outbox.</T></p>}
      <ul>{sms.data?.map((message) => <li key={message.id}>{message.createdAt} · {message.mobile} · {message.status} · {message.body}</li>)}</ul>
    </Section></Block>}
    </PageGrid>
  </>;
}
