import { z } from "zod";
import { email, localDate, text } from "./schema-primitives";

// The website inquiry form (FLOW-109, ADR-13): a small Flowbase-hosted form
// (public/inquiry.html) embedded on the Shopify site. It posts one JSON submission
// to /api/ingest/website. The form generates `submissionId` once per submission, so
// a retry or re-delivery names the same record and creates nothing new.
export const websiteHoneypotField = "company";

export const websiteInquirySchema = z
  .object({
    submissionId: z.string().trim().min(8).max(100),
    name: text(200).min(1, "Enter your name."),
    email: email.default(""),
    phone: text(40).default(""),
    eventDate: z.union([localDate, z.literal("")]).default(""),
    guestCount: z.number().int().min(0).max(100_000).nullable().default(null),
    location: text(500).default(""),
    eventType: text(100).default(""),
    message: text(5_000).default(""),
  })
  .refine((inquiry) => inquiry.email !== "" || inquiry.phone !== "", {
    message: "Enter an email address or phone number.",
    path: ["email"],
  });
export type WebsiteInquiry = z.output<typeof websiteInquirySchema>;
