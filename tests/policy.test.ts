import { describe, expect, it } from "vitest";
import { createSeedSnapshot } from "@/lib/domain/seed";
import { evaluateOffer, mayCloseOnQuote, rankOffers } from "@/lib/domain/policy";

describe("mandate policy", () => {
  it("blocks a rate above the human ceiling", () => {
    const snapshot = createSeedSnapshot();
    expect(
      evaluateOffer(snapshot.operation, snapshot.mandate, {
        amount: 9300,
        currency: "MXN",
        pickupDate: snapshot.operation.pickupDate,
        pickupTime: "10:00",
        conditions: [],
      }),
    ).toEqual({ eligible: false, violations: ["rate_above_mandate"] });
  });

  it("rejects a cheaper carrier when pickup day violates the mandate", () => {
    const snapshot = createSeedSnapshot();
    snapshot.offers = [
      {
        id: "azul",
        operationId: "op-2041",
        carrierId: "carrier-azul",
        callId: "call-a",
        revision: 1,
        amount: 8900,
        currency: "MXN",
        pickupDate: "2026-09-03",
        pickupTime: "11:00",
        conditions: [],
        eligible: true,
        violations: [],
        supersededAt: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "ruta",
        operationId: "op-2041",
        carrierId: "carrier-rutapac",
        callId: "call-r",
        revision: 1,
        amount: 8500,
        currency: "MXN",
        pickupDate: "2026-09-03",
        pickupTime: "10:00",
        conditions: [],
        eligible: true,
        violations: [],
        supersededAt: null,
        createdAt: new Date().toISOString(),
      },
      {
        id: "cheap-but-late",
        operationId: "op-2041",
        carrierId: "carrier-manzanillo",
        callId: "call-m",
        revision: 1,
        amount: 8200,
        currency: "MXN",
        pickupDate: "2026-09-04",
        pickupTime: "09:00",
        conditions: [],
        eligible: false,
        violations: ["pickup_day_outside_mandate"],
        supersededAt: null,
        createdAt: new Date().toISOString(),
      },
    ];
    expect(rankOffers(snapshot).map((offer) => offer.id)).toEqual(["ruta", "azul"]);
  });
});


describe("counter-offer budget", () => {
  const offerAt = (snapshot: ReturnType<typeof createSeedSnapshot>, amount: number) => ({
    amount,
    currency: "MXN" as const,
    pickupDate: snapshot.operation.pickupDate,
    pickupTime: "10:00",
    conditions: [],
  });

  it("allows the opening quote and every authorised counter", () => {
    const snapshot = createSeedSnapshot(); // maximumCounters: 2
    for (const revision of [1, 2, 3]) {
      const decision = evaluateOffer(snapshot.operation, snapshot.mandate, offerAt(snapshot, 8600), revision);
      expect(decision.violations).not.toContain("counter_limit_exhausted");
    }
  });

  it("blocks the counter past the authorised budget", () => {
    const snapshot = createSeedSnapshot();
    const decision = evaluateOffer(snapshot.operation, snapshot.mandate, offerAt(snapshot, 8600), 4);
    expect(decision.eligible).toBe(false);
    expect(decision.violations).toContain("counter_limit_exhausted");
  });

  it("allows only the opening quote when rate negotiation is withheld", () => {
    const snapshot = createSeedSnapshot();
    snapshot.mandate = { ...snapshot.mandate, negotiateRate: false };
    expect(
      evaluateOffer(snapshot.operation, snapshot.mandate, offerAt(snapshot, 8600), 1).violations,
    ).not.toContain("rate_negotiation_not_authorized");
    const countered = evaluateOffer(snapshot.operation, snapshot.mandate, offerAt(snapshot, 8600), 2);
    expect(countered.eligible).toBe(false);
    expect(countered.violations).toContain("rate_negotiation_not_authorized");
  });

  it("counts revisions per carrier through the store", async () => {
    const { MemoryVoltaStore } = await import("@/lib/store/memory");
    globalThis.__voltaSnapshot = undefined;
    const store = new MemoryVoltaStore();
    const snapshot = await store.getSnapshot();
    const call = await store.createCall({ operationId: "op-2041", carrierId: "carrier-azul", mode: "QUOTE" });
    const base = {
      operationId: "op-2041",
      carrierId: "carrier-azul",
      callId: call.id,
      currency: "MXN" as const,
      pickupDate: snapshot.operation.pickupDate,
      pickupTime: "10:00",
    };
    const amounts = [8900, 8800, 8700, 8600];
    const recorded = [];
    for (const amount of amounts) recorded.push(await store.recordOffer({ ...base, amount }));

    expect(recorded.map((offer) => offer.revision)).toEqual([1, 2, 3, 4]);
    expect(recorded[2].violations).not.toContain("counter_limit_exhausted");
    expect(recorded[3].violations).toContain("counter_limit_exhausted");
    expect(recorded[3].eligible).toBe(false);
  });
});

describe("offer restatement", () => {
  it("does not spend a counter when the same terms are recorded twice", async () => {
    const { MemoryVoltaStore } = await import("@/lib/store/memory");
    globalThis.__voltaSnapshot = undefined;
    const store = new MemoryVoltaStore();
    const snapshot = await store.getSnapshot();
    const call = await store.createCall({ operationId: "op-2041", carrierId: "carrier-azul", mode: "QUOTE" });
    const offer = {
      operationId: "op-2041",
      carrierId: "carrier-azul",
      callId: call.id,
      amount: 8700,
      currency: "MXN" as const,
      pickupDate: snapshot.operation.pickupDate,
      pickupTime: "10:00",
    };
    const first = await store.recordOffer(offer);
    const echoed = await store.recordOffer(offer);
    const moved = await store.recordOffer({ ...offer, amount: 8600 });

    expect(echoed.id).toBe(first.id);
    expect(echoed.revision).toBe(1);
    expect(moved.revision).toBe(2);
    expect((await store.getSnapshot()).offers).toHaveLength(2);
  });
});

describe("closing on the quote call", () => {
  const quote = (snapshot: ReturnType<typeof createSeedSnapshot>, carrierId: string, status: string) => ({
    id: `call-${carrierId}`,
    operationId: "op-2041",
    carrierId,
    mode: "QUOTE" as const,
    status: status as "COMPLETED",
    conferenceName: "c",
    twilioCallSid: null,
    twilioAgentCallSid: null,
    openaiCallId: null,
    startedAt: null,
    endedAt: null,
    failureReason: null,
  });
  const offer = (id: string, carrierId: string, amount: number, eligible = true) => ({
    id,
    operationId: "op-2041",
    carrierId,
    callId: `call-${carrierId}`,
    revision: 1,
    amount,
    currency: "MXN" as const,
    pickupDate: "2026-09-03",
    pickupTime: "10:00",
    conditions: [],
    eligible,
    violations: [] as string[],
    supersededAt: null,
    createdAt: "2026-09-01T00:00:00.000Z",
  });

  it("closes immediately when the offer met the target rate", () => {
    const base = createSeedSnapshot(); // target 8500
    const snapshot = {
      ...base,
      offers: [offer("o1", "carrier-azul", 8400)],
      calls: [quote(base, "carrier-azul", "IN_PROGRESS")],
    };
    expect(mayCloseOnQuote(snapshot, "o1")).toEqual({ allowed: true, reason: "met_target_rate" });
  });

  it("waits while another carrier has not answered", () => {
    const base = createSeedSnapshot();
    const snapshot = {
      ...base,
      offers: [offer("o1", "carrier-azul", 8900)],
      calls: [quote(base, "carrier-azul", "IN_PROGRESS")],
    };
    expect(mayCloseOnQuote(snapshot, "o1")).toEqual({ allowed: false, reason: "market_still_open" });
  });

  it("closes above target once the rest of the market has settled", () => {
    const base = createSeedSnapshot();
    const snapshot = {
      ...base,
      offers: [offer("o1", "carrier-azul", 8900)],
      calls: [
        quote(base, "carrier-azul", "IN_PROGRESS"),
        quote(base, "carrier-rutapac", "COMPLETED"),
        quote(base, "carrier-manzanillo", "FAILED"),
      ],
    };
    expect(mayCloseOnQuote(snapshot, "o1")).toEqual({ allowed: true, reason: "market_settled" });
  });

  it("never closes on an offer outside the mandate", () => {
    const base = createSeedSnapshot();
    const snapshot = {
      ...base,
      offers: [offer("o1", "carrier-azul", 8400, false)],
      calls: [quote(base, "carrier-azul", "IN_PROGRESS")],
    };
    expect(mayCloseOnQuote(snapshot, "o1").allowed).toBe(false);
  });
});
