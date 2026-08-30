import { z } from "zod";
import { winner } from "@/lib/domain/policy";
import { isUnequivocalConfirmation } from "@/lib/domain/confirmation";
import { getStore } from "@/lib/store";

export const toolDefinitions = [
  {
    name: "get_operation_context",
    description: "Read the authoritative operation, human mandate, carrier, current offers and commitment state.",
    inputSchema: {
      type: "object",
      properties: { operationId: { type: "string" }, callId: { type: "string" } },
      required: ["operationId", "callId"],
      additionalProperties: false,
    },
  },
  {
    name: "record_offer",
    description: "Record a carrier offer revision. Server policy supersedes prior revisions and decides eligibility.",
    inputSchema: {
      type: "object",
      properties: {
        operationId: { type: "string" },
        carrierId: { type: "string" },
        callId: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", enum: ["MXN"] },
        pickupDate: { type: "string" },
        pickupTime: { type: "string" },
        conditions: { type: "array", items: { type: "string" } },
      },
      required: ["operationId", "carrierId", "callId", "amount", "currency", "pickupDate", "pickupTime"],
      additionalProperties: false,
    },
  },
  {
    name: "stage_booking",
    description: "Stage the canonical recap for the current winning offer. Does not confirm the booking.",
    inputSchema: {
      type: "object",
      properties: {
        operationId: { type: "string" },
        callId: { type: "string" },
        offerId: { type: "string" },
      },
      required: ["operationId", "callId", "offerId"],
      additionalProperties: false,
    },
  },
  {
    name: "confirm_booking",
    description: "Confirm a staged booking only after an unequivocal yes to the exact recap.",
    inputSchema: {
      type: "object",
      properties: {
        commitmentId: { type: "string" },
        confirmationToken: { type: "string" },
        confirmationText: { type: "string" },
      },
      required: ["commitmentId", "confirmationToken", "confirmationText"],
      additionalProperties: false,
    },
  },
  {
    name: "report_operational_change",
    description: "Evaluate a requested change against the mandate without applying unauthorized changes.",
    inputSchema: {
      type: "object",
      properties: {
        operationId: { type: "string" },
        callId: { type: "string" },
        requestedPickupDate: { type: "string" },
        requestedAmount: { type: "number" },
        description: { type: "string" },
      },
      required: ["operationId", "callId", "description"],
      additionalProperties: false,
    },
  },
  {
    name: "request_handoff",
    description: "Create a live human escalation when the requested action is outside authority.",
    inputSchema: {
      type: "object",
      properties: {
        operationId: { type: "string" },
        callId: { type: "string" },
        reason: { type: "string" },
        requestedChange: { type: "string" },
      },
      required: ["operationId", "callId", "reason", "requestedChange"],
      additionalProperties: false,
    },
  },
] as const;

const base = z.object({ operationId: z.string(), callId: z.string() });
const schemas = {
  get_operation_context: base,
  record_offer: base.extend({
    carrierId: z.string(),
    amount: z.number().positive(),
    currency: z.literal("MXN"),
    pickupDate: z.string(),
    pickupTime: z.string().regex(/^\d{2}:\d{2}$/),
    conditions: z.array(z.string()).optional(),
  }),
  stage_booking: base.extend({ offerId: z.string() }),
  confirm_booking: z.object({
    commitmentId: z.string(),
    confirmationToken: z.string(),
    confirmationText: z.string().min(1),
  }),
  report_operational_change: base.extend({
    requestedPickupDate: z.string().optional(),
    requestedAmount: z.number().optional(),
    description: z.string().min(1),
  }),
  request_handoff: base.extend({ reason: z.string().min(1), requestedChange: z.string().min(1) }),
};

export async function executeTool(name: string, rawArguments: unknown): Promise<unknown> {
  const store = getStore();
  switch (name) {
    case "get_operation_context": {
      const input = schemas.get_operation_context.parse(rawArguments);
      const snapshot = await store.getSnapshot(input.operationId);
      const selected = winner(snapshot);
      return {
        operation: snapshot.operation,
        mandate: snapshot.mandate,
        carriers: snapshot.carriers.map((carrier) => ({
          id: carrier.id,
          operationId: carrier.operationId,
          name: carrier.name,
          dispatcher: carrier.dispatcher,
        })),
        offers: snapshot.offers,
        winningOfferId: selected?.id ?? null,
        commitment: snapshot.commitment
          ? { ...snapshot.commitment, confirmationTokenHash: undefined }
          : null,
      };
    }
    case "record_offer": {
      const input = schemas.record_offer.parse(rawArguments);
      const offer = await store.recordOffer(input);
      return {
        offerId: offer.id,
        revision: offer.revision,
        eligible: offer.eligible,
        violations: offer.violations,
        instruction: offer.eligible
          ? "Offer recorded. Do not call it a booking."
          : "Offer is outside authority. Do not accept it.",
      };
    }
    case "stage_booking": {
      const input = schemas.stage_booking.parse(rawArguments);
      const result = await store.stageBooking(input.operationId, input.offerId, input.callId);
      return {
        commitmentId: result.commitment.id,
        confirmationToken: result.confirmationToken,
        recap: result.commitment.recapText,
        instruction: "Read the recap exactly, then ask for an explicit yes or no.",
      };
    }
    case "confirm_booking": {
      const input = schemas.confirm_booking.parse(rawArguments);
      if (!isUnequivocalConfirmation(input.confirmationText)) {
        const snapshot = await store.getSnapshot();
        if (snapshot.commitment) {
          await store.recordDecision({
            operationId: snapshot.commitment.operationId,
            callId: snapshot.commitment.bookingCallId,
            kind: "AMBIGUOUS_CONFIRMATION",
            outcome: "BLOCK",
            rationale: "The spoken answer was not an unequivocal confirmation of the canonical terms.",
            reasonCodes: ["ambiguous_confirmation"],
            source: "COMMITMENT_ENGINE",
            relatedOfferId: snapshot.commitment.offerId,
            idempotencyKey: `commitment:${snapshot.commitment.id}:ambiguous:${input.confirmationText.toLowerCase().slice(0, 80)}`,
          });
        }
        return { accepted: false, reason: "ambiguous_confirmation" };
      }
      const commitment = await store.confirmBooking(input.commitmentId, input.confirmationToken);
      return {
        accepted: true,
        status: commitment.status,
        instruction: "Thank the dispatcher. The written recap will be sent after the call ends.",
      };
    }
    case "report_operational_change": {
      const input = schemas.report_operational_change.parse(rawArguments);
      const snapshot = await store.getSnapshot(input.operationId);
      const violations: string[] = [];
      if (input.requestedPickupDate && input.requestedPickupDate !== snapshot.operation.pickupDate) {
        if (!snapshot.mandate.changePickupDay) violations.push("pickup_day_change_not_authorized");
      }
      if (input.requestedAmount && input.requestedAmount > snapshot.mandate.maximumRate) {
        violations.push("rate_above_mandate");
      }
      await store.addEvent({
        operationId: input.operationId,
        callId: input.callId,
        type: violations.length ? "change.blocked" : "change.observed",
        severity: violations.length ? "DANGER" : "WARNING",
        summary: input.description,
        payload: { violations },
      });
      await store.recordDecision({
        operationId: input.operationId,
        callId: input.callId,
        kind: "OPERATIONAL_CHANGE_EVALUATED",
        outcome: violations.length ? "BLOCK" : "OBSERVE",
        rationale: violations.length
          ? `Requested change violates: ${violations.join(", ")}.`
          : "Requested change did not expand authority, but still requires explicit confirmation before commitment.",
        reasonCodes: violations.length ? violations : ["within_current_authority"],
        source: "MANDATE_ENGINE",
        idempotencyKey: `change:${input.callId}:${input.description.toLowerCase().slice(0, 100)}:${violations.join("|")}`,
      });
      return {
        allowed: violations.length === 0,
        escalation_required: violations.length > 0,
        violations,
        instruction: violations.length
          ? "Do not change the commitment. Explain the authority limit and request_handoff."
          : "Record the request; do not imply a new commitment without explicit confirmation.",
      };
    }
    case "request_handoff": {
      const input = schemas.request_handoff.parse(rawArguments);
      const escalation = await store.createEscalation(
        input.operationId,
        input.callId,
        input.reason,
        input.requestedChange,
      );
      return {
        escalationId: escalation.id,
        status: escalation.status,
        instruction: "Tell the caller a human operator is being brought in, then wait without negotiating.",
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
