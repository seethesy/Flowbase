import { describe, expect, it } from "vitest";
import { isForward, pipelineOptions, pipelineStatuses } from "../shared/pipeline";

describe("shared sales pipeline", () => {
  it("keeps Lost last without treating it as a forward step", () => {
    expect(pipelineOptions().map(({ value }) => value)).toEqual([...pipelineStatuses]);
    expect(isForward("inquiry", "p_creation")).toBe(true);
    expect(isForward("p_sent", "closing")).toBe(true);
    expect(isForward("closing", "p_sent")).toBe(false);
    expect(isForward("closed", "lost")).toBe(false);
    expect(isForward("lost", "inquiry")).toBe(false);
  });
});
