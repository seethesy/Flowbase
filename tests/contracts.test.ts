import { describe, expect, it } from "vitest";
import { recordContractSchema } from "../shared/contracts";

const valid = { signedAt: "2026-11-01T12:00:00.000Z", clientSigner: "Client", salespersonSigner: "Salesperson", cardOnFile: true, cardLast4: "1234", attachmentId: null, noFullCardNumberConfirmed: false };
describe("signed contract input", () => {
  it("accepts only four digits and never takes a full card number", () => {
    expect(recordContractSchema.safeParse(valid).success).toBe(true);
    expect(recordContractSchema.safeParse({ ...valid, cardLast4: "12345" }).success).toBe(false);
    expect(recordContractSchema.safeParse({ ...valid, cardLast4: "123" }).success).toBe(false);
    expect(recordContractSchema.safeParse({ ...valid, cardLast4: "12a4" }).success).toBe(false);
    expect(recordContractSchema.parse({ ...valid, cardNumber: "4111111111111111" })).not.toHaveProperty("cardNumber");
  });
  it("requires confirmation for an uploaded PDF", () => {
    const attachmentId = "00000000-0000-4000-8000-000000000001";
    expect(recordContractSchema.safeParse({ ...valid, attachmentId }).success).toBe(false);
    expect(recordContractSchema.safeParse({ ...valid, attachmentId, noFullCardNumberConfirmed: true }).success).toBe(true);
  });
});
