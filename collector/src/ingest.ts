/// <reference types="node" />
import { createHash } from "node:crypto";
import type { CollectedLead, CollectorRun } from "../../shared/collector.ts";

// Posts to the Worker's machine ingestion endpoints (FLOW-28) with the collector's
// service token: POST /api/ingest/leads, one lead per request (the endpoint stores
// one receipt per record), and POST /api/ingest/collector-runs.
export type Ingest = {
  postLeads: (leads: CollectedLead[]) => Promise<void>;
  postRun: (run: CollectorRun) => Promise<void>;
};

// Names this version of the lead: unchanged leads repeat the id (the Worker ignores
// them), changed ones get a new one.
export function leadRecordId(site: string, sourceLeadId: string, details: unknown) {
  const hash = createHash("sha256").update(JSON.stringify(details)).digest("hex");
  return `${site}:${sourceLeadId}:${hash.slice(0, 16)}`.slice(0, 200);
}

export function httpIngest(options: {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}): Ingest {
  const send = options.fetch ?? fetch;
  const post = async (path: string, body: unknown) => {
    for (let attempt = 1; ; attempt += 1) {
      const response = await send(new URL(path, options.baseUrl), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${options.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      if (response.ok) return;
      // One retry for a Worker or network hiccup; anything else is a real failure.
      if (response.status < 500 || attempt >= 2)
        throw new Error(`POST ${path} answered ${response.status}.`);
    }
  };
  return {
    postLeads: async (leads) => {
      for (const lead of leads) await post("/api/ingest/leads", lead);
    },
    postRun: (run) => post("/api/ingest/collector-runs", run),
  };
}
