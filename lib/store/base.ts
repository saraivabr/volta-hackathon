import { createHash, randomBytes, randomUUID } from "node:crypto";
import { transitionCommitment } from "@/lib/domain/commitment";
import { assertOfferBookable, evaluateOffer, winner } from "@/lib/domain/policy";
import { voiceProviderTag } from "@/lib/providers/transport";
import type {
  CallAttempt,
  Commitment,
  DecisionInput,
  Escalation,
  Evidence,
  LedgerEvent,
  Offer,
  OfferInput,
  OperationalDecision,
  OperationSnapshot,
  TranscriptInput,
  TranscriptSegment,
} from "@/lib/domain/types";
import type {
  CreateCallInput,
  EventInput,
  StageBookingResult,
  UpdateCallInput,
  VoltaStore,
} from "./types";

const clone = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");

function normalizeSnapshot(snapshot: OperationSnapshot): OperationSnapshot {
  snapshot.transcripts ??= [];
  snapshot.decisions ??= [];
  snapshot.callBriefs ??= [];
  return snapshot;
}

/** True when the incoming offer says exactly what the standing one already says. */
function restatesOffer(standing: Offer, incoming: OfferInput): boolean {
  const sameConditions =
    standing.conditions.length === (incoming.conditions?.length ?? 0) &&
    standing.conditions.every((condition) => incoming.conditions?.includes(condition));
  return (
    standing.amount === incoming.amount &&
    standing.currency === incoming.currency &&
    standing.pickupDate === incoming.pickupDate &&
    standing.pickupTime === incoming.pickupTime &&
    sameConditions
  );
}

export abstract class BaseSnapshotStore implements VoltaStore {
  protected abstract readSnapshot(operationId?: string): Promise<OperationSnapshot>;
  protected abstract writeSnapshot(snapshot: OperationSnapshot, expectedVersion: number): Promise<boolean>;
  protected abstract seedSnapshot(): Promise<OperationSnapshot>;

  async getSnapshot(operationId = "op-2041") {
    return clone(normalizeSnapshot(await this.readSnapshot(operationId)));
  }

  protected async mutate<T>(fn: (snapshot: OperationSnapshot) => T | Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const snapshot = clone(normalizeSnapshot(await this.readSnapshot()));
      const expectedVersion = snapshot.version;
      const result = await fn(snapshot);
      snapshot.operation.updatedAt = now();
      snapshot.version = expectedVersion + 1;
      if (await this.writeSnapshot(snapshot, expectedVersion)) return clone(result);
    }
    throw new Error("Concurrent operation update; retry the action");
  }

  async updateConfiguration(
    operationId: string,
    input: Parameters<VoltaStore["updateConfiguration"]>[1],
  ) {
    return this.mutate((snapshot) => {
      if (snapshot.operation.id !== operationId) throw new Error("Operation not found");
      const { mandate, carriers, ...operation } = input;
      snapshot.operation = { ...snapshot.operation, ...operation, id: snapshot.operation.id };
      snapshot.mandate = { ...snapshot.mandate, ...mandate, operationId };
      if (carriers) {
        const updates = new Map(carriers.map((carrier) => [carrier.id, carrier]));
        if (updates.size !== snapshot.carriers.length || snapshot.carriers.some((carrier) => !updates.has(carrier.id))) {
          throw new Error("Every configured carrier must be provided");
        }
        snapshot.carriers = snapshot.carriers.map((carrier) => ({
          ...carrier,
          ...updates.get(carrier.id),
          operationId,
        }));
      }
      this.pushEvent(snapshot, {
        operationId,
        type: "mandate.updated",
        summary: "Human mandate updated",
        payload: { changedFields: Object.keys(input) },
      });
      return snapshot;
    });
  }

  async createCall(input: CreateCallInput) {
    return this.mutate((snapshot) => {
      if (snapshot.operation.id !== input.operationId) throw new Error("Operation not found");
      const id = randomUUID();
      const call: CallAttempt = {
        id,
        operationId: input.operationId,
        carrierId: input.carrierId ?? null,
        mode: input.mode,
        status: "QUEUED",
        conferenceName: input.conferenceName ?? `volta-${input.operationId}-${id.slice(0, 8)}`,
        twilioCallSid: null,
        twilioAgentCallSid: null,
        openaiCallId: null,
        provider: voiceProviderTag(),
        providerCallId: null,
        startedAt: null,
        endedAt: null,
        failureReason: null,
      };
      snapshot.calls.push(call);
      this.pushEvent(snapshot, {
        operationId: input.operationId,
        callId: id,
        type: "call.queued",
        summary: `${input.mode.toLowerCase()} call queued`,
        payload: { carrierId: call.carrierId },
      });
      return call;
    });
  }

  async updateCall(callId: string, input: UpdateCallInput) {
    return this.mutate((snapshot) => {
      const call = snapshot.calls.find((item) => item.id === callId);
      if (!call) throw new Error("Call not found");
      Object.assign(call, input);
      if (input.status === "IN_PROGRESS" && !call.startedAt) call.startedAt = now();
      if (["COMPLETED", "FAILED"].includes(input.status ?? "") && !call.endedAt) call.endedAt = now();
      if (call.mode === "QUOTE" && ["COMPLETED", "FAILED"].includes(input.status ?? "")) {
        const quoteCalls = snapshot.calls.filter((item) => item.mode === "QUOTE");
        if (
          quoteCalls.length >= snapshot.carriers.length &&
          quoteCalls.every((item) => ["COMPLETED", "FAILED"].includes(item.status))
        ) {
          snapshot.operation.status = "QUOTED";
        }
      }
      this.pushEvent(snapshot, {
        operationId: call.operationId,
        callId,
        type: `call.${(input.status ?? call.status).toLowerCase()}`,
        severity: input.status === "FAILED" ? "DANGER" : "INFO",
        summary: `Call ${input.status?.toLowerCase() ?? "updated"}`,
      });
      return call;
    });
  }

  async recordTranscript(input: TranscriptInput) {
    return this.mutate((snapshot) => {
      const call = snapshot.calls.find((item) => item.id === input.callId);
      if (!call || call.operationId !== input.operationId) throw new Error("Call not found");
      const existing = snapshot.transcripts.find(
        (segment) =>
          segment.callId === input.callId &&
          segment.speaker === input.speaker &&
          segment.providerItemId === input.providerItemId,
      );
      if (existing) return existing;
      const segment: TranscriptSegment = {
        id: randomUUID(),
        operationId: input.operationId,
        callId: input.callId,
        speaker: input.speaker,
        providerItemId: input.providerItemId,
        text: input.text.trim(),
        occurredAt: now(),
      };
      snapshot.transcripts.push(segment);
      const unlinkedDecision = snapshot.decisions.find(
        (decision) => decision.callId === input.callId && decision.transcriptSegmentIds.length === 0,
      );
      if (unlinkedDecision) unlinkedDecision.transcriptSegmentIds = [segment.id];
      this.pushEvent(snapshot, {
        operationId: input.operationId,
        callId: input.callId,
        type: "transcript.captured",
        summary: `${input.speaker === "AGENT" ? "Agent" : "Counterparty"} transcript captured`,
        payload: {
          segmentId: segment.id,
          speaker: segment.speaker,
          text: segment.text.slice(0, 240),
          linkedDecisionId: unlinkedDecision?.id ?? null,
        },
      });
      return segment;
    });
  }

  async recordDecision(input: DecisionInput) {
    return this.mutate((snapshot) => this.pushDecision(snapshot, input));
  }

  async finalizeCallBrief(callId: string) {
    return this.mutate((snapshot) => {
      const call = snapshot.calls.find((item) => item.id === callId);
      if (!call) throw new Error("Call not found");
      const directOffers = snapshot.offers
        .filter((offer) => offer.callId === callId)
        .sort((left, right) => left.revision - right.revision);
      const committedOffer =
        snapshot.commitment?.bookingCallId === callId
          ? snapshot.offers.find((offer) => offer.id === snapshot.commitment?.offerId)
          : undefined;
      const offers = directOffers.length ? directOffers : committedOffer ? [committedOffer] : [];
      const decisions = snapshot.decisions.filter((decision) => decision.callId === callId);
      const transcripts = snapshot.transcripts.filter((segment) => segment.callId === callId);
      const existing = snapshot.callBriefs.find((brief) => brief.callId === callId);
      const timestamp = now();
      const brief = {
        id: existing?.id ?? randomUUID(),
        operationId: call.operationId,
        callId,
        carrierId: call.carrierId,
        mode: call.mode,
        outcome: call.status,
        quotedRates: offers.map((offer) => offer.amount),
        finalRate: offers.at(-1)?.amount ?? null,
        conditions: [...new Set(offers.flatMap((offer) => offer.conditions))],
        changes: offers.slice(1).map((offer, index) => {
          const previous = offers[index];
          return `Revision ${previous.revision} → ${offer.revision}: MXN ${previous.amount} → ${offer.amount}, ${previous.pickupDate} ${previous.pickupTime} → ${offer.pickupDate} ${offer.pickupTime}`;
        }),
        actions: decisions.map(
          (decision) => `${decision.outcome}: ${decision.kind.replaceAll("_", " ")} — ${decision.rationale}`,
        ),
        relevantMentions: transcripts.map(
          (segment) => `${segment.speaker === "AGENT" ? "Volta" : "Counterparty"}: ${segment.text}`,
        ),
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      };
      if (existing) Object.assign(existing, brief);
      else snapshot.callBriefs.unshift(brief);
      this.pushEvent(snapshot, {
        operationId: call.operationId,
        callId,
        type: "call_brief.finalized",
        severity: "SUCCESS",
        summary: "Structured call brief finalized",
        payload: { briefId: brief.id, offers: offers.length, decisions: decisions.length },
      });
      return brief;
    });
  }

  async recordOffer(input: OfferInput) {
    return this.mutate((snapshot) => {
      if (snapshot.operation.id !== input.operationId) throw new Error("Operation not found");
      const previous = snapshot.offers
        .filter((offer) => offer.carrierId === input.carrierId)
        .sort((a, b) => b.revision - a.revision)[0];

      // A retried or echoed tool call must not spend a counter-offer. Restating
      // the standing terms is not a new position, so it returns the offer that
      // already exists rather than opening a revision against the budget.
      if (previous && !previous.supersededAt && restatesOffer(previous, input)) return previous;

      if (previous && !previous.supersededAt) previous.supersededAt = now();

      const revision = (previous?.revision ?? 0) + 1;
      const decision = evaluateOffer(snapshot.operation, snapshot.mandate, input, revision);
      const supportingTranscriptIds = snapshot.transcripts
        .filter((segment) => segment.callId === input.callId && segment.speaker === "COUNTERPARTY")
        .slice(-1)
        .map((segment) => segment.id);
      const offer: Offer = {
        id: randomUUID(),
        ...input,
        conditions: input.conditions ?? [],
        revision,
        eligible: decision.eligible,
        violations: decision.violations,
        supersededAt: null,
        createdAt: now(),
      };
      snapshot.offers.push(offer);
      const quoteCalls = snapshot.calls.filter((item) => item.mode === "QUOTE");
      snapshot.operation.status =
        quoteCalls.length >= snapshot.carriers.length &&
        quoteCalls.every((item) => ["COMPLETED", "FAILED"].includes(item.status))
          ? "QUOTED"
          : "SCANNING";
      this.pushEvent(snapshot, {
        operationId: input.operationId,
        callId: input.callId,
        type: decision.eligible ? "offer.eligible" : "offer.blocked",
        severity: decision.eligible ? "SUCCESS" : "WARNING",
        summary: decision.eligible
          ? `Eligible offer recorded at MXN ${offer.amount.toLocaleString("en-US")}`
          : `Offer blocked: ${decision.violations.join(", ")}`,
        payload: { offerId: offer.id, revision: offer.revision, violations: offer.violations },
      });
      this.pushDecision(snapshot, {
        operationId: input.operationId,
        callId: input.callId,
        kind: "OFFER_EVALUATED",
        outcome: decision.eligible ? "ALLOW" : "BLOCK",
        rationale: decision.eligible
          ? "Offer satisfies every rule in the human mandate."
          : `Offer violates: ${decision.violations.join(", ")}.`,
        reasonCodes: decision.violations.length ? decision.violations : ["within_mandate"],
        source: "MANDATE_ENGINE",
        relatedOfferId: offer.id,
        transcriptSegmentIds: supportingTranscriptIds,
        idempotencyKey: `offer:${offer.id}:evaluated`,
      });
      const selected = winner(snapshot);
      if (selected?.id === offer.id) {
        this.pushDecision(snapshot, {
          operationId: input.operationId,
          callId: input.callId,
          kind: "MARKET_WINNER_UPDATED",
          outcome: "SELECT",
          rationale: "Lowest eligible rate, then earliest pickup time and stable carrier-name tie-break.",
          reasonCodes: ["best_eligible_offer"],
          source: "MARKET_RANKING",
          relatedOfferId: offer.id,
          transcriptSegmentIds: supportingTranscriptIds,
          idempotencyKey: `offer:${offer.id}:winner`,
        });
      }
      return offer;
    });
  }

  async stageBooking(operationId: string, offerId: string, callId: string): Promise<StageBookingResult> {
    return this.mutate((snapshot) => {
      if (snapshot.operation.id !== operationId) throw new Error("Operation not found");
      const offer = assertOfferBookable(snapshot, offerId);
      const carrier = snapshot.carriers.find((item) => item.id === offer.carrierId);
      if (!carrier) throw new Error("Carrier not found");

      if (snapshot.commitment && !["SUPERSEDED", "REJECTED"].includes(snapshot.commitment.status)) {
        throw new Error("An active commitment already exists");
      }
      const token = randomBytes(24).toString("base64url");
      const recapText = `Volta / ${snapshot.operation.reference}: ${carrier.name} confirma recolección el ${offer.pickupDate} a las ${offer.pickupTime}, de ${snapshot.operation.pickupLocation} a ${snapshot.operation.deliveryLocation}, por MXN ${offer.amount.toLocaleString("en-US")}.`;
      const commitment: Commitment = {
        id: randomUUID(),
        operationId,
        carrierId: offer.carrierId,
        offerId,
        bookingCallId: callId,
        status: "PROPOSED",
        recapText,
        confirmationTokenHash: hashToken(token),
        tokenExpiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
        verballyConfirmedAt: null,
        recapSentAt: null,
        twilioMessageSid: null,
        committedAt: null,
      };
      snapshot.commitment = commitment;
      snapshot.operation.status = "BOOKING";
      this.pushEvent(snapshot, {
        operationId,
        callId,
        type: "commitment.proposed",
        summary: "Canonical booking recap staged",
        payload: { offerId, carrierId: carrier.id },
      });
      this.pushDecision(snapshot, {
        operationId,
        callId,
        kind: "BOOKING_STAGED",
        outcome: "SELECT",
        rationale: "The server revalidated the current policy-ranked winner before staging canonical terms.",
        reasonCodes: ["winner_revalidated", "canonical_recap_generated"],
        source: "COMMITMENT_ENGINE",
        relatedOfferId: offer.id,
        transcriptSegmentIds: snapshot.transcripts
          .filter((segment) => segment.callId === callId)
          .slice(-2)
          .map((segment) => segment.id),
        idempotencyKey: `commitment:${commitment.id}:staged`,
      });
      return { commitment, confirmationToken: token };
    });
  }

  async confirmBooking(commitmentId: string, confirmationToken: string) {
    return this.mutate((snapshot) => {
      const commitment = snapshot.commitment;
      if (!commitment || commitment.id !== commitmentId) throw new Error("Commitment not found");
      if (new Date(commitment.tokenExpiresAt).getTime() < Date.now()) throw new Error("Confirmation token expired");
      if (hashToken(confirmationToken) !== commitment.confirmationTokenHash) {
        throw new Error("Invalid confirmation token");
      }
      assertOfferBookable(snapshot, commitment.offerId);
      commitment.status = transitionCommitment(commitment.status, "VERBALLY_CONFIRMED");
      commitment.verballyConfirmedAt = now();
      this.pushEvent(snapshot, {
        operationId: commitment.operationId,
        callId: commitment.bookingCallId,
        type: "commitment.verbally_confirmed",
        severity: "SUCCESS",
        summary: "Dispatcher verbally confirmed the canonical recap",
      });
      this.pushDecision(snapshot, {
        operationId: commitment.operationId,
        callId: commitment.bookingCallId,
        kind: "BOOKING_CONFIRMED",
        outcome: "ALLOW",
        rationale: "An explicit confirmation matched a valid staged token and a still-bookable offer.",
        reasonCodes: ["explicit_confirmation", "token_valid", "mandate_revalidated"],
        source: "COMMITMENT_ENGINE",
        relatedOfferId: commitment.offerId,
        transcriptSegmentIds: snapshot.transcripts
          .filter((segment) => segment.callId === commitment.bookingCallId && segment.speaker === "COUNTERPARTY")
          .slice(-1)
          .map((segment) => segment.id),
        idempotencyKey: `commitment:${commitment.id}:confirmed`,
      });
      return commitment;
    });
  }

  async markRecapSent(commitmentId: string, messageSid: string) {
    return this.mutate((snapshot) => {
      const commitment = snapshot.commitment;
      if (!commitment || commitment.id !== commitmentId) throw new Error("Commitment not found");
      commitment.status = transitionCommitment(commitment.status, "RECAP_SENT");
      commitment.recapSentAt = now();
      commitment.twilioMessageSid = messageSid;
      this.pushEvent(snapshot, {
        operationId: commitment.operationId,
        callId: commitment.bookingCallId,
        type: "commitment.recap_sent",
        severity: "SUCCESS",
        summary: "Written recap sent by SMS",
        payload: { messageSid },
      });
      if (snapshot.evidence?.commitmentId === commitment.id) {
        commitment.status = transitionCommitment(commitment.status, "EVIDENCE_LINKED");
        commitment.status = transitionCommitment(commitment.status, "COMMITTED");
        commitment.committedAt = now();
        snapshot.operation.status = "COMMITTED";
        this.pushEvent(snapshot, {
          operationId: commitment.operationId,
          callId: commitment.bookingCallId,
          type: "commitment.committed",
          severity: "SUCCESS",
          summary: "Verified operational commitment created",
          payload: { evidenceId: snapshot.evidence.id },
        });
      }
      return commitment;
    });
  }

  async linkEvidence(
    commitmentId: string,
    input: Omit<Evidence, "id" | "operationId" | "commitmentId" | "verifiedAt">,
  ) {
    return this.mutate((snapshot) => {
      const commitment = snapshot.commitment;
      if (!commitment || commitment.id !== commitmentId) throw new Error("Commitment not found");
      const evidence: Evidence = {
        id: randomUUID(),
        operationId: commitment.operationId,
        commitmentId,
        verifiedAt: now(),
        ...input,
      };
      snapshot.evidence = evidence;
      if (commitment.status === "RECAP_SENT") {
        commitment.status = transitionCommitment(commitment.status, "EVIDENCE_LINKED");
        commitment.status = transitionCommitment(commitment.status, "COMMITTED");
        commitment.committedAt = now();
        snapshot.operation.status = "COMMITTED";
        this.pushEvent(snapshot, {
          operationId: commitment.operationId,
          callId: commitment.bookingCallId,
          type: "commitment.committed",
          severity: "SUCCESS",
          summary: "Verified operational commitment created",
          payload: { evidenceId: evidence.id, startSeconds: evidence.startSeconds },
        });
      } else {
        this.pushEvent(snapshot, {
          operationId: commitment.operationId,
          callId: commitment.bookingCallId,
          type: "evidence.linked_pending_recap",
          severity: "INFO",
          summary: "Audio evidence linked; waiting for written recap",
          payload: { evidenceId: evidence.id },
        });
      }
      return evidence;
    });
  }

  async createEscalation(operationId: string, callId: string, reason: string, requestedChange: string) {
    return this.mutate((snapshot) => {
      const escalation: Escalation = {
        id: randomUUID(),
        operationId,
        callId,
        status: "OPEN",
        reason,
        requestedChange,
        createdAt: now(),
        connectedAt: null,
      };
      snapshot.escalation = escalation;
      snapshot.operation.status = "AT_RISK";
      this.pushEvent(snapshot, {
        operationId,
        callId,
        type: "escalation.requested",
        severity: "DANGER",
        summary: reason,
        payload: { requestedChange },
      });
      this.pushDecision(snapshot, {
        operationId,
        callId,
        kind: "HUMAN_HANDOFF_REQUIRED",
        outcome: "ESCALATE",
        rationale: reason,
        reasonCodes: ["outside_delegated_authority"],
        source: "MANDATE_ENGINE",
        idempotencyKey: `escalation:${escalation.id}:required`,
      });
      return escalation;
    });
  }

  async updateEscalation(id: string, status: Escalation["status"]) {
    return this.mutate((snapshot) => {
      const escalation = snapshot.escalation;
      if (!escalation || escalation.id !== id) throw new Error("Escalation not found");
      escalation.status = status;
      if (status === "CONNECTED") escalation.connectedAt = now();
      this.pushEvent(snapshot, {
        operationId: escalation.operationId,
        callId: escalation.callId,
        type: `escalation.${status.toLowerCase()}`,
        severity: status === "CONNECTED" ? "SUCCESS" : "WARNING",
        summary: `Human handoff ${status.toLowerCase()}`,
      });
      return escalation;
    });
  }

  async addEvent(input: EventInput) {
    return this.mutate((snapshot) => this.pushEvent(snapshot, input));
  }

  protected pushEvent(snapshot: OperationSnapshot, input: EventInput): LedgerEvent {
    const event: LedgerEvent = {
      id: randomUUID(),
      operationId: input.operationId,
      callId: input.callId ?? null,
      type: input.type,
      severity: input.severity ?? "INFO",
      summary: input.summary,
      payload: input.payload ?? {},
      occurredAt: now(),
    };
    snapshot.events.unshift(event);
    snapshot.events = snapshot.events.slice(0, 100);
    return event;
  }

  protected pushDecision(snapshot: OperationSnapshot, input: DecisionInput): OperationalDecision {
    const existing = snapshot.decisions.find((decision) => decision.idempotencyKey === input.idempotencyKey);
    if (existing) return existing;
    const decision: OperationalDecision = {
      id: randomUUID(),
      operationId: input.operationId,
      callId: input.callId,
      kind: input.kind,
      outcome: input.outcome,
      rationale: input.rationale,
      reasonCodes: input.reasonCodes ?? [],
      source: input.source,
      relatedOfferId: input.relatedOfferId ?? null,
      transcriptSegmentIds: input.transcriptSegmentIds ?? [],
      idempotencyKey: input.idempotencyKey,
      createdAt: now(),
    };
    snapshot.decisions.unshift(decision);
    snapshot.decisions = snapshot.decisions.slice(0, 100);
    this.pushEvent(snapshot, {
      operationId: input.operationId,
      callId: input.callId,
      type: `decision.${input.kind.toLowerCase()}`,
      severity: input.outcome === "BLOCK" || input.outcome === "ESCALATE" ? "WARNING" : "SUCCESS",
      summary: input.rationale,
      payload: {
        decisionId: decision.id,
        outcome: decision.outcome,
        reasonCodes: decision.reasonCodes,
        relatedOfferId: decision.relatedOfferId,
      },
    });
    return decision;
  }

  async reset() {
    const snapshot = await this.seedSnapshot();
    const current = await this.readSnapshot().catch(() => null);
    snapshot.version = (current?.version ?? 0) + 1;
    await this.writeSnapshot(snapshot, current?.version ?? 0);
    return clone(snapshot);
  }
}
