import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookWinningOffer, startMarketScan } from "@/lib/services/operations";
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
