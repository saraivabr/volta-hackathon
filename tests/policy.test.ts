import { describe, expect, it } from "vitest";
import { createSeedSnapshot } from "@/lib/domain/seed";
import { evaluateOffer, rankOffers } from "@/lib/domain/policy";

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

