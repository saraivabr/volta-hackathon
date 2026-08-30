import type { OperationSnapshot } from "./types";

const now = "2026-08-29T18:00:00.000Z";

export function createSeedSnapshot(): OperationSnapshot {
  return {
    version: 1,
    operation: {
      id: "op-2041",
      reference: "OP-2041",
      customer: "Textiles Pacífico",
      containerReference: "CNTR-39201",
      pickupLocation: "Port of Manzanillo",
      deliveryLocation: "Guadalajara",
      pickupDate: "2026-09-03",
      pickupWindowStart: "08:00",
      pickupWindowEnd: "16:00",
      status: "DRAFT",
      createdAt: now,
      updatedAt: now,
    },
    mandate: {
      operationId: "op-2041",
      currency: "MXN",
      targetRate: 8500,
      maximumRate: 9000,
      negotiateRate: true,
      changePickupDay: false,
      acceptAccessorials: false,
      maximumCounters: 2,
    },
    carriers: [
      {
        id: "carrier-azul",
        operationId: "op-2041",
        name: "Azul Cargo",
        dispatcher: "María Torres",
        phoneE164: "+525500000101",
      },
      {
        id: "carrier-rutapac",
        operationId: "op-2041",
        name: "RutaPac",
        dispatcher: "Carlos Medina",
        phoneE164: "+525500000102",
      },
      {
        id: "carrier-manzanillo",
        operationId: "op-2041",
        name: "Manzanillo Express",
        dispatcher: "Juan Ríos",
        phoneE164: "+525500000103",
      },
    ],
    calls: [],
    offers: [],
    commitment: null,
    evidence: null,
    escalation: null,
    transcripts: [],
    decisions: [],
    callBriefs: [],
    events: [
      {
        id: "event-seed",
        operationId: "op-2041",
        callId: null,
        type: "operation.seeded",
        severity: "INFO",
        summary: "Human mandate created",
        payload: { source: "demo_seed" },
        occurredAt: now,
      },
    ],
  };
}
