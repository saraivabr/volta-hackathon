import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { autoBookIfSettled, startMarketScan, startRenegotiation } from "@/lib/services/operations";
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
    const snapshot = await startMarketScan("op-2041");

    expect(snapshot.commitment).not.toBeNull();
    expect(snapshot.commitment?.status).toBe("RECAP_SENT");
    expect(snapshot.commitment?.committedAt).toBeNull();
    expect(snapshot.evidence).toBeNull();
  });

  it("records that the booking was simulated so the ledger says so", async () => {
    const snapshot = await startMarketScan("op-2041");

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
    const booked = await startMarketScan("op-2041");
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
    // Nothing the market returned fits, so nothing was ever agreed.
    await getStore().updateConfiguration("op-2041", { mandate: { maximumRate: 1000 } });
    await startMarketScan("op-2041");
    await expect(startRenegotiation("op-2041")).rejects.toThrow(/no standing agreement/i);
  });

  it("lets a new booking be staged once the old one is retired", async () => {
    await startMarketScan("op-2041");
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

/**
 * The operator delegates once. Choosing between the quotes and closing the deal
 * is the agent's job, and so is calling a human when the market leaves nothing
 * the mandate allows.
 */
describe("working the market unattended", () => {
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

  it("books the standing winner once every quote call has settled", async () => {
    const after = await startMarketScan("op-2041");

    expect(after.commitment).not.toBeNull();
    expect(after.commitment?.status).toBe("RECAP_SENT");
    expect(after.calls.some((call) => call.mode === "BOOKING")).toBe(true);
    expect(after.events.some((event) => event.type === "market.settled")).toBe(true);

    const cheapest = [...after.offers].sort((a, b) => a.amount - b.amount)[0];
    expect(cheapest.eligible).toBe(false);
    expect(after.commitment?.offerId).not.toBe(cheapest.id);
  });

  it("does not book twice when the market settles again", async () => {
    await startMarketScan("op-2041");
    const before = await getStore().getSnapshot("op-2041");
    const bookings = before.calls.filter((call) => call.mode === "BOOKING").length;

    expect(await autoBookIfSettled("op-2041")).toBeNull();
    const after = await getStore().getSnapshot("op-2041");
    expect(after.calls.filter((call) => call.mode === "BOOKING")).toHaveLength(bookings);
  });

  it("calls a human when nothing the market returned fits the mandate", async () => {
    const store = getStore();
    await store.updateConfiguration("op-2041", { mandate: { maximumRate: 1000 } });
    const after = await startMarketScan("op-2041");

    expect(after.commitment).toBeNull();
    expect(after.escalation?.status).toBe("OPEN");
    expect(after.escalation?.reason).toMatch(/outside the mandate/i);
    expect(after.operation.status).toBe("AT_RISK");
  });
});
