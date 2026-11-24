import { expect, it } from "vitest";
import { staffIds } from "../../shared/staff";

// FLOW-333 A1: the staff ID is the phone number's last 4 digits, lengthened
// one digit at a time while another listed number ends the same way.
it("uses the last 4 digits, adding digits only where numbers collide", () => {
  const ids = staffIds([
    { id: "a", mobile: "(202) 555-0123" },
    { id: "b", mobile: "202-555-4567" },
    { id: "c", mobile: "2025559123" },
    { id: "d", mobile: "2025558123" },
    { id: "e", mobile: "2025540123" },
  ]);
  expect(ids.get("b")).toBe("4567");
  // 9123 and 8123 differ at the 4th-last digit, so 4 digits are enough.
  expect(ids.get("c")).toBe("9123");
  expect(ids.get("d")).toBe("8123");
  // a and e both end in 0123, so both get a 5th digit.
  expect(ids.get("a")).toBe("50123");
  expect(ids.get("e")).toBe("40123");
});

it("leaves the ID blank without a phone number and keeps the whole number for identical ones", () => {
  const ids = staffIds([
    { id: "a", mobile: "" },
    { id: "b", mobile: null },
    { id: "c", mobile: "2025550123" },
    { id: "d", mobile: "202-555-0123" },
    { id: "e", mobile: "123" },
  ]);
  expect(ids.get("a")).toBe("");
  expect(ids.get("b")).toBe("");
  expect(ids.get("c")).toBe("2025550123");
  expect(ids.get("d")).toBe("2025550123");
  // Shorter than 4 digits: the whole number.
  expect(ids.get("e")).toBe("123");
});
