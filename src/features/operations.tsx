import { z } from "zod";
import { useAuth } from "../app/auth";
import { useResource } from "../app/useResource";
import { PageHeader, Section, LoadingSkeleton } from "../components/shared";
import { LoadError } from "../components/record-display";
import { request } from "../services/core";

const itemSchema = z.object({ id: z.string(), status: z.string().optional(), source: z.string().optional(), lastError: z.string().nullable().optional() });
export function OperationsPage() {
  const role = useAuth()?.user.role;
  const jobs = useResource(["operations-jobs"], () => request(itemSchema.array(), "/api/admin/jobs?status=failed"));
  const receipts = useResource(["operations-receipts"], () => request(itemSchema.array(), "/api/admin/ingest-receipts?status=failed"));
  if (role !== "admin" && role !== "technical") return <p role="alert">You do not have access to operations.</p>;
  if (jobs.error || receipts.error) return <LoadError message={jobs.error ?? receipts.error ?? "Unable to load operations."} />;
  return <>
    <PageHeader title="Operations" subtitle="Failed background work and ingest receipts" />
    {!jobs.data || !receipts.data ? <LoadingSkeleton /> : <>
      <section id="jobs"><Section title="Failed jobs"><ul>{jobs.data.map((item) => <li key={item.id}>{item.id} · {item.status ?? "failed"}{item.lastError && ` · ${item.lastError}`}</li>)}</ul></Section></section>
      <section id="receipts"><Section title="Failed ingest receipts"><ul>{receipts.data.map((item) => <li key={item.id}>{item.id} · {item.source ?? "ingest"}{item.lastError && ` · ${item.lastError}`}</li>)}</ul></Section></section>
    </>}
  </>;
}
