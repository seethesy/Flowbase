import { describe, expect, it } from "vitest";
import {
  checkProposalFiles,
  docxExportHint,
  DOCX_TYPE,
  manualProposalTargets,
  PDF_TYPE,
  proposalStageChangeSchema,
  proposalStages,
  proposalUploadSchema,
} from "../shared/proposals";

// Proposal stage rules (FLOW-122) and version file rules (FLOW-123).

describe("stage transitions", () => {
  it("moves by hand only between the manual stages, back to Revisions, or to Lost", () => {
    expect(manualProposalTargets("client_communication")).toEqual([
      "menu_curation",
      "revisions",
      "lost",
    ]);
    for (const from of ["finalized", "approved", "sent"] as const)
      expect(manualProposalTargets(from)).toEqual([
        "client_communication",
        "menu_curation",
        "revisions",
        "lost",
      ]);
    expect(manualProposalTargets("signed")).toEqual([]);
    expect(manualProposalTargets("lost")).toEqual([]);
  });

  // AC1
  it("never offers Finalized, Approved, Sent or Signed as a manual target", () => {
    for (const from of proposalStages)
      for (const to of ["finalized", "approved", "sent", "signed"] as const)
        expect(manualProposalTargets(from)).not.toContain(to);
    for (const stage of ["finalized", "approved", "sent", "signed"])
      expect(proposalStageChangeSchema.safeParse({ stage }).success).toBe(false);
  });

  // AC2
  it("requires a reason for Lost", () => {
    const missing = proposalStageChangeSchema.safeParse({ stage: "lost" });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0].message).toBe("Enter why the proposal was lost.");
    expect(
      proposalStageChangeSchema.safeParse({ stage: "lost", reason: "Budget" })
        .success,
    ).toBe(true);
    expect(
      proposalStageChangeSchema.safeParse({ stage: "revisions" }).success,
    ).toBe(true);
  });
});

describe("version files", () => {
  const docx = { fileName: "Proposal.docx", contentType: DOCX_TYPE, size: 40_000 };
  const pdf = { fileName: "Proposal.pdf", contentType: PDF_TYPE, size: 90_000 };

  it("takes a .docx with an optional PDF", () => {
    expect(proposalUploadSchema.safeParse({ docx }).success).toBe(true);
    expect(proposalUploadSchema.safeParse({ docx, pdf }).success).toBe(true);
    expect(
      proposalUploadSchema.safeParse({ docx, pdf: { ...docx } }).error?.issues[0]
        .message,
    ).toBe("The reference copy must be a PDF.");
  });

  // AC3
  it("rejects a PDF-only upload with the export hint", () => {
    for (const body of [{ pdf }, { docx: pdf }, {}])
      expect(proposalUploadSchema.safeParse(body).error?.issues[0].message).toBe(
        docxExportHint,
      );
  });

  // AC3, in the browser before anything uploads.
  it("checks the picked files", () => {
    const file = (name: string, type: string, size = 1000) => ({ name, type, size });
    expect(checkProposalFiles([file("Proposal.docx", DOCX_TYPE)])).toBeUndefined();
    expect(
      checkProposalFiles([
        file("Proposal.docx", DOCX_TYPE),
        file("Proposal.pdf", PDF_TYPE),
      ]),
    ).toBeUndefined();
    expect(checkProposalFiles([file("Proposal.pdf", PDF_TYPE)])).toBe(docxExportHint);
    expect(checkProposalFiles([])).toBe(docxExportHint);
    expect(
      checkProposalFiles([
        file("A.docx", DOCX_TYPE),
        file("B.docx", DOCX_TYPE),
      ]),
    ).toBe(docxExportHint);
    expect(
      checkProposalFiles([file("A.docx", DOCX_TYPE), file("photo.jpg", "image/jpeg")]),
    ).toBe("Pick one .docx and, optionally, one PDF of the same version.");
    expect(
      checkProposalFiles([file("A.docx", DOCX_TYPE, 21 * 1024 * 1024)]),
    ).toBe("Proposal files can be at most 20 MB.");
  });
});
