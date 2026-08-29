import { describe, expect, it } from "vitest";
import { canTransitionCommitment, transitionCommitment } from "@/lib/domain/commitment";

describe("commitment state machine", () => {
  it("requires verification steps in order", () => {
    expect(canTransitionCommitment("PROPOSED", "COMMITTED")).toBe(false);
    expect(canTransitionCommitment("PROPOSED", "VERBALLY_CONFIRMED")).toBe(true);
    expect(canTransitionCommitment("VERBALLY_CONFIRMED", "RECAP_SENT")).toBe(true);
    expect(canTransitionCommitment("RECAP_SENT", "EVIDENCE_LINKED")).toBe(true);
    expect(canTransitionCommitment("EVIDENCE_LINKED", "COMMITTED")).toBe(true);
  });

  it("fails closed on invalid transitions", () => {
    expect(() => transitionCommitment("PROPOSED", "COMMITTED")).toThrow(
      "Invalid commitment transition",
    );
  });
});

