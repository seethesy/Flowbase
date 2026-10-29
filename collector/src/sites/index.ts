import type { SiteModule } from "../types.ts";
import { barkModule } from "./bark.ts";
import { eventectiveModule } from "./eventective.ts";
import { perfectVenueModule } from "./perfect-venue.ts";
import { weddingProModule } from "./weddingpro.ts";

// The site modules the collector runs, in order. FLOW-103 (Bark), FLOW-104 (Perfect
// Venue), FLOW-105 (WeddingPro) and FLOW-106 (Eventective) each add theirs here.
const configured = (name: string, create: (url: string) => SiteModule) => {
  const url = process.env[`COLLECTOR_${name}_BASE_URL`];
  return url ? [create(url)] : [];
};

export const siteModules: SiteModule[] = [
  ...configured("BARK", barkModule),
  ...configured("PERFECT_VENUE", perfectVenueModule),
  ...configured("WEDDINGPRO", weddingProModule),
  ...configured("EVENTECTIVE", eventectiveModule),
];
