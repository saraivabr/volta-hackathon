import { beforeEach, describe, expect, it } from "vitest";
import { MemoryVoltaStore } from "@/lib/store/memory";

describe("Volta store", () => {
  const store = new MemoryVoltaStore();

  beforeEach(async () => {
    globalThis.__voltaSnapshot = undefined;
    await store.getSnapshot();
  });

  it("persists a complete operator briefing before calls begin", async () => {
    const current = await store.getSnapshot();
    await store.updateConfiguration("op-2041", {
      reference: "OP-9001",
      customer: "Acme Textiles",
      containerReference: "CONT-7788",
      pickupLocation: "Veracruz Port",
      deliveryLocation: "Mexico City",
      pickupDate: "2026-09-10",
      pickupWindowStart: "09:00",
      pickupWindowEnd: "14:00",
      mandate: {
        targetRate: 7600,
        maximumRate: 8100,
        maximumCounters: 1,
      },
      carriers: current.carriers.map((carrier, index) => ({
        id: carrier.id,
        name: `Carrier ${index + 1}`,
        dispatcher: `Dispatcher ${index + 1}`,
        phoneE164: `+52550000010${index + 1}`,
      })),
    });
    const snapshot = await store.getSnapshot();
    expect(snapshot.operation).toMatchObject({
      reference: "OP-9001",
      customer: "Acme Textiles",
      pickupLocation: "Veracruz Port",
      deliveryLocation: "Mexico City",
    });
    expect(snapshot.mandate).toMatchObject({ targetRate: 7600, maximumRate: 8100, maximumCounters: 1 });
    expect(snapshot.carriers[0]).toMatchObject({ name: "Carrier 1", dispatcher: "Dispatcher 1" });
  });

  it("supersedes corrected offers and blocks the corrected out-of-mandate amount", async () => {
    const call = await store.createCall({ operationId: "op-2041", carrierId: "carrier-rutapac", mode: "QUOTE" });
    const first = await store.recordOffer({
      operationId: "op-2041",
      carrierId: "carrier-rutapac",
      callId: call.id,
      amount: 8500,
      currency: "MXN",
      pickupDate: "2026-09-03",
      pickupTime: "10:00",
    });
    const correction = await store.recordOffer({
      operationId: "op-2041",
      carrierId: "carrier-rutapac",
      callId: call.id,
      amount: 9300,
      currency: "MXN",
      pickupDate: "2026-09-03",
      pickupTime: "10:00",
    });
    const snapshot = await store.getSnapshot();
    expect(snapshot.offers.find((offer) => offer.id === first.id)?.supersededAt).not.toBeNull();
    expect(correction.revision).toBe(2);
    expect(correction.eligible).toBe(false);
    expect(correction.violations).toContain("rate_above_mandate");
    expect(snapshot.decisions.some((decision) =>
      decision.relatedOfferId === correction.id &&
      decision.outcome === "BLOCK" &&
      decision.reasonCodes.includes("rate_above_mandate")
    )).toBe(true);
  });

  it("stores final transcript turns idempotently and links them to policy decisions", async () => {
    const call = await store.createCall({ operationId: "op-2041", carrierId: "carrier-azul", mode: "QUOTE" });
    await store.recordOffer({
      operationId: "op-2041",
      carrierId: "carrier-azul",
      callId: call.id,
      amount: 8900,
      currency: "MXN",
      pickupDate: "2026-09-03",
      pickupTime: "11:00",
    });
    const input = {
      operationId: "op-2041",
      callId: call.id,
      speaker: "COUNTERPARTY" as const,
      providerItemId: "item-counterparty-1",
      text: "Podemos recoger el jueves a las once por ocho mil novecientos pesos.",
    };
    const first = await store.recordTranscript(input);
    const duplicate = await store.recordTranscript(input);
    const snapshot = await store.getSnapshot();
    expect(duplicate.id).toBe(first.id);
    expect(snapshot.transcripts.filter((segment) => segment.providerItemId === input.providerItemId)).toHaveLength(1);
    expect(snapshot.decisions.some((decision) => decision.transcriptSegmentIds.includes(first.id))).toBe(true);
  });

  it("finalizes a structured call brief with rates, changes, actions, and relevant mentions", async () => {
    const call = await store.createCall({ operationId: "op-2041", carrierId: "carrier-rutapac", mode: "QUOTE" });
    await store.recordOffer({
      operationId: "op-2041",
      carrierId: "carrier-rutapac",
      callId: call.id,
      amount: 9100,
      currency: "MXN",
      pickupDate: "2026-09-03",
      pickupTime: "10:00",
    });
    await store.recordTranscript({
      operationId: "op-2041",
      callId: call.id,
      speaker: "COUNTERPARTY",
      providerItemId: "brief-counterparty-1",
      text: "Puedo bajar a ocho mil quinientos para el jueves a las diez.",
    });
    await store.recordOffer({
      operationId: "op-2041",
      carrierId: "carrier-rutapac",
      callId: call.id,
      amount: 8500,
      currency: "MXN",
      pickupDate: "2026-09-03",
      pickupTime: "10:00",
    });
    await store.updateCall(call.id, { status: "COMPLETED" });

    const brief = await store.finalizeCallBrief(call.id);
    expect(brief.outcome).toBe("COMPLETED");
    expect(brief.quotedRates).toEqual([9100, 8500]);
    expect(brief.finalRate).toBe(8500);
    expect(brief.changes[0]).toContain("MXN 9100 → 8500");
    expect(brief.actions.some((action) => action.includes("OFFER EVALUATED"))).toBe(true);
    expect(brief.relevantMentions).toContain(
      "Counterparty: Puedo bajar a ocho mil quinientos para el jueves a las diez.",
    );
  });

  it("does not become committed before recap and evidence", async () => {
    const call = await store.createCall({ operationId: "op-2041", carrierId: "carrier-rutapac", mode: "BOOKING" });
    const offer = await store.recordOffer({
      operationId: "op-2041",
      carrierId: "carrier-rutapac",
      callId: call.id,
      amount: 8500,
      currency: "MXN",
      pickupDate: "2026-09-03",
      pickupTime: "10:00",
    });
    const staged = await store.stageBooking("op-2041", offer.id, call.id);
    await store.confirmBooking(staged.commitment.id, staged.confirmationToken);
    expect((await store.getSnapshot()).commitment?.status).toBe("VERBALLY_CONFIRMED");
    await store.markRecapSent(staged.commitment.id, "SM_TEST");
    expect((await store.getSnapshot()).commitment?.status).toBe("RECAP_SENT");
    await store.linkEvidence(staged.commitment.id, {
      callId: call.id,
      recordingUrl: "/test.wav",
      storagePath: null,
      speaker: "dispatcher",
      segmentText: "Sí, confirmo.",
      startSeconds: 4,
      endSeconds: 6,
    });
    expect((await store.getSnapshot()).commitment?.status).toBe("COMMITTED");
  });
  it("refuses to attach evidence to a booking nobody confirmed", async () => {
    const snapshot = await store.getSnapshot();
    const call = await store.createCall({ operationId: "op-2041", carrierId: "carrier-rutapac", mode: "BOOKING" });
    await store.recordOffer({
      operationId: "op-2041",
      carrierId: "carrier-rutapac",
      callId: call.id,
      amount: 8500,
      currency: "MXN",
      pickupDate: snapshot.operation.pickupDate,
      pickupTime: "10:00",
    });
    const current = await store.getSnapshot();
    const staged = await store.stageBooking("op-2041", current.offers[0].id, call.id);

    // Still PROPOSED: the recap was read but no answer came back.
    await expect(
      store.linkEvidence(staged.commitment.id, {
        callId: call.id,
        recordingUrl: "/api/recordings/x",
        storagePath: null,
        speaker: "A",
        segmentText: " Okay.",
        startSeconds: 83.018,
        endSeconds: 84.568,
      }),
    ).rejects.toThrow(/verbally confirmed/i);
    expect((await store.getSnapshot()).evidence).toBeNull();
  });
});
