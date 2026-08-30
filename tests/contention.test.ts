import { describe, expect, it } from "vitest";
import { MemoryVoltaStore } from "@/lib/store/memory";

/**
 * Three carriers are negotiated at once and each live call streams transcript
 * turns, offers and events into the same snapshot. Before writes were queued,
 * seventy-five concurrent turns kept four — the rest lost the version race and
 * were dropped, taking the evidence surface with them.
 */
describe("concurrent writers", () => {
  it("keeps every transcript turn when three calls stream at once", async () => {
    globalThis.__voltaSnapshot = undefined;
    const store = new MemoryVoltaStore();
    await store.getSnapshot();
    const call = await store.createCall({ operationId: "op-2041", carrierId: "carrier-azul", mode: "QUOTE" });

    const turns = 75;
    const results = await Promise.allSettled(
      Array.from({ length: turns }, (_, i) =>
        store.recordTranscript({
          operationId: "op-2041",
          callId: call.id,
          speaker: i % 2 ? "AGENT" : "COUNTERPARTY",
          providerItemId: `item-${i}`,
          text: `turn ${i}`,
        }),
      ),
    );

    expect(results.filter((result) => result.status === "rejected")).toHaveLength(0);
    expect((await store.getSnapshot()).transcripts).toHaveLength(turns);
  });

  it("keeps offers and events consistent while writers compete", async () => {
    globalThis.__voltaSnapshot = undefined;
    const store = new MemoryVoltaStore();
    const snapshot = await store.getSnapshot();
    const calls = await Promise.all(
      snapshot.carriers.map((carrier) =>
        store.createCall({ operationId: "op-2041", carrierId: carrier.id, mode: "QUOTE" }),
      ),
    );

    await Promise.all(
      calls.flatMap((call, index) => [
        store.recordOffer({
          operationId: "op-2041",
          carrierId: call.carrierId!,
          callId: call.id,
          amount: 8500 + index * 100,
          currency: "MXN",
          pickupDate: snapshot.operation.pickupDate,
          pickupTime: "10:00",
        }),
        store.addEvent({ operationId: "op-2041", callId: call.id, type: "test.event", summary: `writer ${index}` }),
      ]),
    );

    const after = await store.getSnapshot();
    expect(after.offers).toHaveLength(calls.length);
    expect(after.events.filter((event) => event.type === "test.event")).toHaveLength(calls.length);
    // One version per accepted write, never a shared one.
    expect(new Set(after.offers.map((offer) => offer.id)).size).toBe(calls.length);
  });

  // A business rule rejection is an answer, not a race: it must not be retried.
  it("propagates a domain rejection without retrying it", async () => {
    globalThis.__voltaSnapshot = undefined;
    const store = new MemoryVoltaStore();
    await store.getSnapshot();
    await expect(store.markRecapSent("missing-commitment", "SM_X")).rejects.toThrow(/Commitment not found/);
  });
});
