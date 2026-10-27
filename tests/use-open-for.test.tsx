import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useOpenFor, useStateFor } from "../src/app/useOpenFor";

// FLOW-197: per-record state resets when the page moves to another record.
it("keeps a value only for the record it was set on", () => {
  const { result, rerender } = renderHook(({ id }) => useStateFor(id, ""), {
    initialProps: { id: "a" },
  });
  act(() => result.current[1]("draft for A"));
  expect(result.current[0]).toBe("draft for A");
  rerender({ id: "b" });
  expect(result.current[0]).toBe("");
  rerender({ id: "a" });
  // Coming back to A starts fresh rather than reviving A's old draft.
  expect(result.current[0]).toBe("");
});

it("closes a form when the record changes and reopens it only on request", () => {
  const { result, rerender } = renderHook(({ id }) => useOpenFor(id), {
    initialProps: { id: "a" },
  });
  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
  rerender({ id: "b" });
  expect(result.current[0]).toBe(false);
  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
  act(() => result.current[1](false));
  expect(result.current[0]).toBe(false);
});
