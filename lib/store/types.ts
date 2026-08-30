import type {
  CallAttempt,
  CallBrief,
  CallMode,
  CallStatus,
  Carrier,
  Commitment,
  DecisionInput,
  Escalation,
  Evidence,
  LedgerEvent,
  Mandate,
  Offer,
  OfferInput,
  Operation,
  OperationSnapshot,
  OperationalDecision,
  Severity,
  TranscriptInput,
  TranscriptSegment,
} from "@/lib/domain/types";

export interface EventInput {
  operationId: string;
  callId?: string | null;
  type: string;
  severity?: Severity;
  summary: string;
  payload?: Record<string, unknown>;
}

export interface CreateCallInput {
  operationId: string;
  carrierId?: string | null;
  mode: CallMode;
  conferenceName?: string;
}

export interface UpdateCallInput {
  status?: CallStatus;
  twilioCallSid?: string | null;
  twilioAgentCallSid?: string | null;
  openaiCallId?: string | null;
  provider?: "TWILIO" | "WHATSAPP" | "TELNYX";
  providerCallId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  failureReason?: string | null;
}

export interface StageBookingResult {
  commitment: Commitment;
  confirmationToken: string;
}

export interface VoltaStore {
  getSnapshot(operationId?: string): Promise<OperationSnapshot>;
  updateConfiguration(
    operationId: string,
    input: Partial<Operation> & {
      mandate?: Partial<Mandate>;
      carriers?: Array<Pick<Carrier, "id" | "name" | "dispatcher" | "phoneE164">>;
    },
  ): Promise<OperationSnapshot>;
  createCall(input: CreateCallInput): Promise<CallAttempt>;
  updateCall(callId: string, input: UpdateCallInput): Promise<CallAttempt>;
  recordTranscript(input: TranscriptInput): Promise<TranscriptSegment>;
  recordDecision(input: DecisionInput): Promise<OperationalDecision>;
  finalizeCallBrief(callId: string): Promise<CallBrief>;
  recordOffer(input: OfferInput): Promise<Offer>;
  stageBooking(operationId: string, offerId: string, callId: string): Promise<StageBookingResult>;
  confirmBooking(commitmentId: string, confirmationToken: string): Promise<Commitment>;
  markRecapSent(commitmentId: string, messageSid: string): Promise<Commitment>;
  linkEvidence(
    commitmentId: string,
    evidence: Omit<Evidence, "id" | "operationId" | "commitmentId" | "verifiedAt">,
  ): Promise<Evidence>;
  createEscalation(
    operationId: string,
    callId: string,
    reason: string,
    requestedChange: string,
  ): Promise<Escalation>;
  updateEscalation(id: string, status: Escalation["status"]): Promise<Escalation>;
  addEvent(input: EventInput): Promise<LedgerEvent>;
  reset(): Promise<OperationSnapshot>;
}
