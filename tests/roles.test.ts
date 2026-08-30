import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

/**
 * The published code must open the operation and drive none of it. Getting
 * this wrong in either direction is expensive: too strict and the judge sees
 * nothing, too loose and a stranger resets the demo mid-call.
 */
describe("access roles", () => {
  const original = { ...process.env };
  beforeEach(() => {
    vi.resetModules();
    process.env.SESSION_SECRET = "a".repeat(40);
    process.env.DEMO_ACCESS_CODE = "operator-code";
    process.env.DEMO_VIEWER_CODE = "viewer-code";
  });
  afterEach(() => {
    process.env = { ...original };
  });

  it("gives the operator code an operator session", async () => {
    const { verifyAccessCode } = await import("@/lib/server/auth");
    expect(verifyAccessCode("operator-code")).toBe("operator");
  });

  it("gives the published code a viewer session", async () => {
    const { verifyAccessCode } = await import("@/lib/server/auth");
    expect(verifyAccessCode("viewer-code")).toBe("viewer");
  });

  it("refuses anything else", async () => {
    const { verifyAccessCode } = await import("@/lib/server/auth");
    expect(verifyAccessCode("volta-2041-64d508")).toBeNull();
    expect(verifyAccessCode("")).toBeNull();
  });

  it("round-trips a viewer session without promoting it", async () => {
    const { issueSession, sessionRole } = await import("@/lib/server/auth");
    expect(await sessionRole(await issueSession("viewer"))).toBe("viewer");
    expect(await sessionRole(await issueSession("operator"))).toBe("operator");
  });

  it("refuses a session signed with another secret", async () => {
    const { issueSession } = await import("@/lib/server/auth");
    const token = await issueSession("operator");
    vi.resetModules();
    process.env.SESSION_SECRET = "b".repeat(40);
    const { sessionRole } = await import("@/lib/server/auth");
    expect(await sessionRole(token)).toBeNull();
  });
});
