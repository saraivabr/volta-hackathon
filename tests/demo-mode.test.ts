import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookWinningOffer, startMarketScan, startRenegotiation } from "@/lib/services/operations";
import { getStore } from "@/lib/store";

/**
 * The commitment ledger is the one surface whose entire purpose is to be
 * checkable. A simulated run has no recording behind it, so it must never
 * present itself as verified — otherwise the audit trail asserts something
 * nobody can falsify.
 */
describe("simulated booking", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.VOLTA_DEMO_MODE = "true";
    globalThis.__voltaSnapshot = undefined;
    globalThis.__voltaStore = undefined;
  });

  afterEach(() => {
    process.env = { ...original };
    globalThis.__voltaSnapshot = undefined;
    globalThis.__voltaStore = undefined;
  });

  it("never fabricates audio evidence or reaches COMMITTED", async () => {
    await startMarketScan("op-2041");
    const snapshot = await bookWinningOffer("op-2041");

    expect(snapshot.commitment).not.toBeNull();
    expect(snapshot.commitment?.status).toBe("RECAP_SENT");
    expect(snapshot.commitment?.committedAt).toBeNull();
    expect(snapshot.evidence).toBeNull();
  });

  it("records that the booking was simulated so the ledger says so", async () => {
    await startMarketScan("op-2041");
    const snapshot = await bookWinningOffer("op-2041");

    const disclosure = snapshot.events.find((event) => event.type === "demo.booking_simulated");
    expect(disclosure).toBeDefined();
    expect(disclosure?.severity).toBe("WARNING");
    expect(disclosure?.summary).toMatch(/no audio evidence/i);
  });

  it("still picks the mandate-eligible winner rather than the cheapest offer", async () => {
    await startMarketScan("op-2041");
    const snapshot = await getStore().getSnapshot("op-2041");

    const cheapest = [...snapshot.offers].sort((a, b) => a.amount - b.amount)[0];
    expect(cheapest.eligible).toBe(false);
    expect(snapshot.offers.some((offer) => offer.eligible)).toBe(true);
  });
});

/**
 * The challenge asks for a renegotiation: circumstances change after a carrier
 * already agreed, and the agent calls back without exceeding the mandate.
 */
describe("renegotiation", () => {
  const original = { ...process.env };

  beforeEach(() => {
    process.env.VOLTA_DEMO_MODE = "true";
    globalThis.__voltaSnapshot = undefined;
    globalThis.__voltaStore = undefined;
  });

  afterEach(() => {
    process.env = { ...original };
    globalThis.__voltaSnapshot = undefined;
    globalThis.__voltaStore = undefined;
  });

  it("retires the standing agreement and calls the same carrier back", async () => {
    await startMarketScan("op-2041");
    const booked = await bookWinningOffer("op-2041");
    const carrierId = booked.commitment?.carrierId;
    expect(booked.commitment?.status).toBe("RECAP_SENT");

    const after = await startRenegotiation("op-2041");

    expect(after.commitment?.status).toBe("SUPERSEDED");
    expect(after.operation.status).toBe("AT_RISK");
    expect(after.evidence).toBeNull();

    const callback = after.calls.filter((call) => call.mode === "RENEGOTIATION");
    expect(callback).toHaveLength(1);
    expect(callback[0].carrierId).toBe(carrierId);

    const disclosure = after.events.find((event) => event.type === "commitment.superseded");
    expect(disclosure?.summary).toMatch(/briefing changed/i);
  });

  it("refuses when there is no standing agreement to renegotiate", async () => {
    await startMarketScan("op-2041");
    await expect(startRenegotiation("op-2041")).rejects.toThrow(/no standing agreement/i);
  });

  it("lets a new booking be staged once the old one is retired", async () => {
    await startMarketScan("op-2041");
    await bookWinningOffer("op-2041");
    await startRenegotiation("op-2041");

    const store = getStore();
    const snapshot = await store.getSnapshot("op-2041");
    const { winner } = await import("@/lib/domain/policy");
    const standing = winner(snapshot)!;
    const call = snapshot.calls.find((item) => item.mode === "RENEGOTIATION")!;

    const staged = await store.stageBooking("op-2041", standing.id, call.id);
    expect(staged.commitment.status).toBe("PROPOSED");
  });
});
