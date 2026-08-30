import { z } from "zod";
import { mayCloseOnQuote, winner } from "@/lib/domain/policy";
import { judgeConfirmation } from "@/lib/services/confirmation-judge";
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

/** The agent needs to know what to do next, not just that it was refused. */
function instructionFor(eligible: boolean, violations: string[]): string {
  if (eligible) return "Offer recorded. Do not call it a booking.";
  if (violations.includes("counter_limit_exhausted")) {
    return "The authorised number of counter-offers is spent. Take the best standing offer or request_handoff — do not counter again.";
  }
  if (violations.includes("rate_negotiation_not_authorized")) {
    return "You were not authorised to negotiate price. Record what they quoted, do not counter, and move on.";
  }
  return "Offer is outside authority. Do not accept it.";
}

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
        instruction: instructionFor(offer.eligible, offer.violations),
      };
    }
    case "stage_booking": {
      const input = schemas.stage_booking.parse(rawArguments);
      const snapshot = await store.getSnapshot(input.operationId);
      const call = snapshot.calls.find((item) => item.id === input.callId);

      // A quote call may close the deal, but only when the engine says the
      // market no longer justifies calling back.
      if (call?.mode === "QUOTE") {
        const verdict = mayCloseOnQuote(snapshot, input.offerId);
        if (!verdict.allowed) {
          return {
            staged: false,
            reason: verdict.reason,
            instruction:
              verdict.reason === "market_still_open"
                ? "Other carriers have not answered yet. Finish this as a quote and say a decision follows shortly."
                : "This offer cannot be booked. Keep it as a quote.",
          };
        }
      }

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
      const pending = await store.getSnapshot();
      const judgement = await judgeConfirmation(
        pending.commitment?.recapText ?? "",
        input.confirmationText,
      );
      if (judgement.verdict !== "CONFIRMS") {
        if (pending.commitment) {
          await store.recordDecision({
            operationId: pending.commitment.operationId,
            callId: pending.commitment.bookingCallId,
            kind: "AMBIGUOUS_CONFIRMATION",
            outcome: "BLOCK",
            rationale: `Answer judged ${judgement.verdict.toLowerCase()} against the canonical terms: ${judgement.reason}.`,
            reasonCodes: [judgement.verdict.toLowerCase(), judgement.source.toLowerCase()],
            source: "COMMITMENT_ENGINE",
            relatedOfferId: pending.commitment.offerId,
            idempotencyKey: `commitment:${pending.commitment.id}:ambiguous:${input.confirmationText.toLowerCase().slice(0, 80)}`,
          });
        }
        return {
          accepted: false,
          reason: judgement.verdict === "CONDITIONAL" ? "conditional_agreement" : "ambiguous_confirmation",
          // The agent needs to know what to do next, not just that it failed.
          instruction:
            judgement.verdict === "REFUSES"
              ? "They declined. Ask what they need changed, or close the call without a commitment."
              : judgement.verdict === "CONDITIONAL"
                ? "They attached a condition. Handle it as a new offer, not a confirmation."
                : "Read the recap once more and ask plainly whether they confirm those exact terms.",
        };
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
      // Escalating is a consequence of the refusal, not a favour the model does
      // afterwards. The engine opens it here so a model that never calls
      // request_handoff cannot leave a blocked change with nobody watching it.
      if (violations.length) {
        await store.createEscalation(
          input.operationId,
          input.callId,
          `Blocked change outside the mandate: ${input.description}`,
          input.description,
        );
      }
      return {
        allowed: violations.length === 0,
        escalation_required: violations.length > 0,
        violations,
        instruction: violations.length
          ? "A human has already been brought in. Tell the caller that, explain the authority limit, and wait without negotiating."
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
