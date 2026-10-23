import type { Page } from "@playwright/test";
import type { CollectedLead, CollectorRunStatus } from "../../shared/collector.ts";

// The lead collector framework (FLOW-102, ADR-14). Each lead site is a module with
// this interface (FLOW-103 to FLOW-106 add Bark, Perfect Venue, WeddingPro and
// Eventective); the framework drives them one page at a time and posts what they
// read to the Worker.

// A lead as a module reads it: the normalized lead fields (F-09-01) without the
// ids and source, which the framework fills in.
export type ReadLead = Omit<CollectedLead, "sourceRecordId" | "site" | "source" | "sourceLeadId">;

export type ListedLead = {
  // The site's own lead id.
  id: string;
  // When the site last changed the lead, if it shows it; leads not changed since
  // the last successful run are skipped.
  updatedAt?: string;
};

// What a module may do with the browser. visit() is the only way to navigate: it
// waits a human interval between pages, enforces the page limit, and stops the site
// on a CAPTCHA, two-factor prompt or block.
export type SiteContext = {
  page: Page;
  visit: (url: string) => Promise<void>;
  // The site's login, from the ops repo secrets; undefined when not configured.
  credentials?: { username: string; password: string };
};

export type SiteModule = {
  // Short id, used for state files, secrets and CollectorRun records ("bark").
  site: string;
  // The lead source shown in Flowbase ("Bark").
  source: string;
  // True when the saved session is still signed in.
  checkLogin: (context: SiteContext) => Promise<boolean>;
  // Signs in with the credentials. Optional: without it, an expired session reports
  // needs_login. Must never answer a two-factor prompt or CAPTCHA.
  logIn?: (context: SiteContext) => Promise<void>;
  // Leads that are new or updated since the last run, newest first.
  listLeads: (context: SiteContext, since: Date | null) => Promise<ListedLead[]>;
  readLead: (context: SiteContext, id: string) => Promise<ReadLead>;
};

// Thrown by visit() or a module to stop the current site with that status.
export class SiteStopped extends Error {
  readonly status: Exclude<CollectorRunStatus, "ok">;
  constructor(status: Exclude<CollectorRunStatus, "ok">, message: string) {
    super(message);
    this.name = "SiteStopped";
    this.status = status;
  }
}
