import { z } from "zod";
import { useAuth } from "../app/auth";
import { useResource } from "../app/useResource";
import { PageHeader, Section, LoadingSkeleton } from "../components/shared";
import { LoadError } from "../components/record-display";
import { request } from "../services/core";
import { T } from "../app/copy";

const itemSchema = z.object({ id: z.string(), status: z.string().optional(), source: z.string().optional(), lastError: z.string().nullable().optional() });
export function OperationsPage() {
  const role = useAuth()?.user.role;
  const jobs = useResource(["operations-jobs"], () => request(itemSchema.array(), "/api/admin/jobs?status=failed"));
  const receipts = useResource(["operations-receipts"], () => request(itemSchema.array(), "/api/admin/ingest-receipts?status=failed"));
  if (role !== "admin" && role !== "technical") return <p role="alert"><T id="operations.operations-page.you-do-not-have-access">You do not have access to operations.</T></p>;
  if (jobs.error || receipts.error) return <LoadError message={jobs.error ?? receipts.error ?? "Unable to load operations."} />;
  return <>
    <PageHeader title={<T id="operations.operations-page.operations">Operations</T>} subtitle={<T id="operations.operations-page.failed-background-work-and-ingest">Failed background work and ingest receipts</T>} />
    {!jobs.data || !receipts.data ? <LoadingSkeleton /> : <>
      <section id="jobs"><Section title={<T id="operations.operations-page.failed-jobs">Failed jobs</T>}><ul>{jobs.data.map((item) => <li key={item.id}>{item.id} · {item.status ?? <T id="operations.operations-page.failed">failed</T>}{item.lastError && ` · ${item.lastError}`}</li>)}</ul></Section></section>
      <section id="receipts"><Section title={<T id="operations.operations-page.failed-ingest-receipts">Failed ingest receipts</T>}><ul>{receipts.data.map((item) => <li key={item.id}>{item.id} · {item.source ?? <T id="operations.operations-page.ingest">ingest</T>}{item.lastError && ` · ${item.lastError}`}</li>)}</ul></Section></section>
    </>}
  </>;
}
