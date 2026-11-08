import { describe, expect, it } from "vitest";
import {
  allocatePayments,
  dollarsToCents,
  dueForReminder,
  formatCents,
  looksLikeCardNumber,
  parsePaymentLine,
  paymentInputSchema,
  paymentTotals,
  scheduleItemInputSchema,
} from "../shared/payments";

// Payment schedule and log rules (FLOW-131) and the overdue and reminder rules
// (FLOW-132), all in integer cents. Dates are New York calendar dates, so the
// "fake clock" is just the `today` argument.

const item = (id: string, amountCents: number, dueDate: string) => ({
  id,
  amountCents,
  dueDate,
});

describe("payment totals", () => {
  it("shows a $3,500 balance on a $5,000 total with a $1,500 deposit (AC1)", () => {
    const totals = paymentTotals(
      [item("deposit", 150_000, "2026-10-01"), item("balance", 350_000, "2026-11-07")],
      150_000,
      "2026-10-15",
    );
    expect(totals.totalCents).toBe(500_000);
    expect(totals.paidCents).toBe(150_000);
    expect(totals.balanceCents).toBe(350_000);
    expect(formatCents(totals.balanceCents)).toBe("$3,500.00");
    expect(totals.overdueCount).toBe(0);
  });

  it("goes negative when the client has paid more than the schedule", () => {
    const totals = paymentTotals([item("a", 10_000, "2026-10-01")], 12_500, "2026-10-15");
    expect(totals.balanceCents).toBe(-2_500);
  });

  it("is all zeros with nothing scheduled or paid", () => {
    expect(paymentTotals([], 0, "2026-10-15")).toMatchObject({
      totalCents: 0,
      paidCents: 0,
      balanceCents: 0,
      overdueCount: 0,
      overdueCents: 0,
    });
  });
});

describe("allocatePayments", () => {
  it("applies money to the earliest due items first", () => {
    const allocated = allocatePayments(
      [item("a", 100, "2026-10-01"), item("b", 200, "2026-11-01"), item("c", 300, "2026-12-01")],
      250,
      "2026-10-15",
    );
    expect(allocated.map((i) => i.paidCents)).toEqual([100, 150, 0]);
    expect(allocated.map((i) => i.remainingCents)).toEqual([0, 50, 300]);
  });

  it("flags past-due items with money still owed as overdue (FLOW-132 AC2)", () => {
    const allocated = allocatePayments(
      [item("a", 100, "2026-10-01"), item("b", 200, "2026-10-10"), item("c", 300, "2026-10-15")],
      100,
      "2026-10-15",
    );
    expect(allocated.map((i) => i.overdue)).toEqual([false, true, false]);
  });

  it("does not flag a paid item, even long past its date", () => {
    const [paid] = allocatePayments([item("a", 100, "2026-01-01")], 100, "2026-10-15");
    expect(paid.overdue).toBe(false);
  });

  it("is not overdue on the due date itself", () => {
    const [due] = allocatePayments([item("a", 100, "2026-10-15")], 0, "2026-10-15");
    expect(due.overdue).toBe(false);
  });
});

describe("dueForReminder", () => {
  const items = allocatePayments(
    [
      item("past", 100, "2026-10-10"),
      item("covered", 100, "2026-10-16"),
      item("soon", 100, "2026-10-18"),
      item("later", 100, "2026-10-19"),
    ],
    200,
    "2026-10-15",
  );

  it("includes an item due exactly N days out (AC1: due in 3 days)", () => {
    // The $200 received covers "past" and "covered", the two earliest.
    const ids = dueForReminder(items, "2026-10-15", 3).map((i) => i.id);
    expect(ids).toEqual(["soon"]);
  });

  it("leaves out items further out than the window", () => {
    expect(dueForReminder(items, "2026-10-15", 2)).toEqual([]);
    expect(dueForReminder(items, "2026-10-15", 4).map((i) => i.id)).toEqual(["soon", "later"]);
  });

  it("leaves out items already past due, which are overdue instead", () => {
    expect(dueForReminder(items, "2026-10-15", 30).map((i) => i.id)).not.toContain("past");
  });

  it("includes an item due today", () => {
    const [today] = allocatePayments([item("t", 100, "2026-10-15")], 0, "2026-10-15");
    expect(dueForReminder([today], "2026-10-15", 3)).toHaveLength(1);
  });
});

describe("payment input", () => {
  const base = { method: "zelle", amountCents: 150_000, receivedOn: "2026-10-01" };

  it("rejects a full card number in the reference (AC2)", () => {
    for (const reference of [
      "4242424242424242",
      "4242 4242 4242 4242",
      "4242-4242-4242-4242",
      "card 4242 4242 4242 4242 ok",
    ]) {
      const result = paymentInputSchema.safeParse({ ...base, reference });
      expect(result.success, reference).toBe(false);
    }
  });

  it("accepts a last-4 or a confirmation code", () => {
    for (const reference of ["", "last4 4242", "ZEL-8841", "check #1042", "CONF 12345678"]) {
      expect(paymentInputSchema.safeParse({ ...base, reference }).success, reference).toBe(true);
    }
  });

  it("detects card-length digit runs only", () => {
    expect(looksLikeCardNumber("4242424242424242")).toBe(true);
    expect(looksLikeCardNumber("4242")).toBe(false);
    expect(looksLikeCardNumber("123456789012")).toBe(false);
  });

  it("requires a positive whole number of cents and a known method", () => {
    expect(paymentInputSchema.safeParse({ ...base, amountCents: 0 }).success).toBe(false);
    expect(paymentInputSchema.safeParse({ ...base, amountCents: -5 }).success).toBe(false);
    expect(paymentInputSchema.safeParse({ ...base, amountCents: 10.5 }).success).toBe(false);
    expect(paymentInputSchema.safeParse({ ...base, method: "bitcoin" }).success).toBe(false);
  });

  it("accepts every method the business takes", () => {
    for (const method of ["card", "zelle", "ach", "wire", "check", "cash"])
      expect(paymentInputSchema.safeParse({ ...base, method }).success, method).toBe(true);
  });
});

describe("schedule item input", () => {
  it("needs a kind, a positive amount and a due date", () => {
    const ok = { kind: "deposit", amountCents: 150_000, dueDate: "2026-10-01" };
    expect(scheduleItemInputSchema.safeParse(ok).success).toBe(true);
    expect(scheduleItemInputSchema.safeParse({ ...ok, kind: "tip" }).success).toBe(false);
    expect(scheduleItemInputSchema.safeParse({ ...ok, amountCents: 0 }).success).toBe(false);
    expect(scheduleItemInputSchema.safeParse({ ...ok, dueDate: "10/01/2026" }).success).toBe(false);
  });
});

describe("dollars and lines", () => {
  it("converts dollars to whole cents without float drift", () => {
    expect(dollarsToCents("1,500")).toBe(150_000);
    expect(dollarsToCents("$19.99")).toBe(1_999);
    expect(dollarsToCents("0.1")).toBe(10);
    expect(dollarsToCents("12.345")).toBeNull();
    expect(dollarsToCents("abc")).toBeNull();
    expect(dollarsToCents("")).toBeNull();
  });

  it("reads a proposal's payment line", () => {
    expect(parsePaymentLine("Deposit $1,500.00 due 11/20/2026")).toMatchObject({
      kind: "deposit",
      amountCents: 150_000,
      dueDate: "2026-11-20",
    });
    expect(parsePaymentLine("Balance of $3,500 due Dec 1, 2026")).toMatchObject({
      kind: "balance",
      amountCents: 350_000,
      dueDate: "2026-12-01",
    });
    expect(parsePaymentLine("Second payment 2026-12-05")).toMatchObject({
      kind: "installment",
      amountCents: null,
      dueDate: "2026-12-05",
    });
  });

  it("leaves a line it can't read for the person to fill in", () => {
    expect(parsePaymentLine("Payable on receipt")).toMatchObject({
      amountCents: null,
      dueDate: null,
    });
  });
});
