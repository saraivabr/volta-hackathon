export type OperationStatus =
  | "DRAFT"
  | "SCANNING"
  | "QUOTED"
  | "BOOKING"
  | "COMMITTED"
  | "AT_RISK";

export type CallMode = "QUOTE" | "BOOKING" | "INBOUND" | "HANDOFF";
export type CallStatus =
  | "QUEUED"
  | "RINGING"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "FAILED";

export type CommitmentStatus =
  | "PROPOSED"
  | "VERBALLY_CONFIRMED"
  | "RECAP_SENT"
  | "EVIDENCE_LINKED"
  | "COMMITTED"
  | "SUPERSEDED"
  | "REJECTED"
  | "VERIFICATION_FAILED"
  | "ESCALATED";

export type Severity = "INFO" | "SUCCESS" | "WARNING" | "DANGER";
export type TranscriptSpeaker = "AGENT" | "COUNTERPARTY";
export type DecisionOutcome = "ALLOW" | "BLOCK" | "SELECT" | "ESCALATE" | "OBSERVE";

export interface Operation {
  id: string;
  reference: string;
  customer: string;
  containerReference: string;
  pickupLocation: string;
  deliveryLocation: string;
  pickupDate: string;
  pickupWindowStart: string;
  pickupWindowEnd: string;
  status: OperationStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Mandate {
  operationId: string;
  currency: "MXN";
  targetRate: number;
  maximumRate: number;
  negotiateRate: boolean;
  changePickupDay: boolean;
  acceptAccessorials: boolean;
  maximumCounters: number;
}

export interface Carrier {
  id: string;
  operationId: string;
  name: string;
  dispatcher: string;
  phoneE164: string;
}

export interface CallAttempt {
  id: string;
  operationId: string;
  carrierId: string | null;
  mode: CallMode;
  status: CallStatus;
  conferenceName: string;
  twilioCallSid: string | null;
  twilioAgentCallSid: string | null;
  openaiCallId: string | null;
  provider?: "TWILIO" | "WHATSAPP";
  providerCallId?: string | null;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
}

export interface Offer {
  id: string;
  operationId: string;
  carrierId: string;
  callId: string;
  revision: number;
  amount: number;
  currency: "MXN";
  pickupDate: string;
  pickupTime: string;
  conditions: string[];
  eligible: boolean;
  violations: string[];
  supersededAt: string | null;
  createdAt: string;
}

export interface Commitment {
  id: string;
  operationId: string;
  carrierId: string;
  offerId: string;
  bookingCallId: string;
  status: CommitmentStatus;
  recapText: string;
  confirmationTokenHash: string;
  tokenExpiresAt: string;
  verballyConfirmedAt: string | null;
  recapSentAt: string | null;
  twilioMessageSid: string | null;
  committedAt: string | null;
}

export interface Evidence {
  id: string;
  operationId: string;
  commitmentId: string;
  callId: string;
  recordingUrl: string;
  storagePath: string | null;
  speaker: string;
  segmentText: string;
  startSeconds: number;
  endSeconds: number;
  verifiedAt: string;
}

export interface Escalation {
  id: string;
  operationId: string;
  callId: string;
  status: "OPEN" | "DIALING" | "CONNECTED" | "RESOLVED";
  reason: string;
  requestedChange: string;
  createdAt: string;
  connectedAt: string | null;
}

export interface LedgerEvent {
  id: string;
  operationId: string;
  callId: string | null;
  type: string;
  severity: Severity;
  summary: string;
  payload: Record<string, unknown>;
  occurredAt: string;
}

export interface TranscriptSegment {
  id: string;
  operationId: string;
  callId: string;
  speaker: TranscriptSpeaker;
  providerItemId: string;
  text: string;
  occurredAt: string;
}

export interface OperationalDecision {
  id: string;
  operationId: string;
  callId: string;
  kind: string;
  outcome: DecisionOutcome;
  rationale: string;
  reasonCodes: string[];
  source: "MANDATE_ENGINE" | "COMMITMENT_ENGINE" | "MARKET_RANKING";
  relatedOfferId: string | null;
  transcriptSegmentIds: string[];
  idempotencyKey: string;
  createdAt: string;
}

export interface CallBrief {
  id: string;
  operationId: string;
  callId: string;
  carrierId: string | null;
  mode: CallMode;
  outcome: CallStatus;
  quotedRates: number[];
  finalRate: number | null;
  conditions: string[];
  changes: string[];
  actions: string[];
  relevantMentions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface OperationSnapshot {
  version: number;
  operation: Operation;
  mandate: Mandate;
  carriers: Carrier[];
  calls: CallAttempt[];
  offers: Offer[];
  commitment: Commitment | null;
  evidence: Evidence | null;
  escalation: Escalation | null;
  transcripts: TranscriptSegment[];
  decisions: OperationalDecision[];
  callBriefs: CallBrief[];
  events: LedgerEvent[];
}

export interface OfferInput {
  operationId: string;
  carrierId: string;
  callId: string;
  amount: number;
  currency: "MXN";
  pickupDate: string;
  pickupTime: string;
  conditions?: string[];
}

export interface TranscriptInput {
  operationId: string;
  callId: string;
  speaker: TranscriptSpeaker;
  providerItemId: string;
  text: string;
}

export interface DecisionInput {
  operationId: string;
  callId: string;
  kind: string;
  outcome: DecisionOutcome;
  rationale: string;
  reasonCodes?: string[];
  source: OperationalDecision["source"];
  relatedOfferId?: string | null;
  transcriptSegmentIds?: string[];
  idempotencyKey: string;
}
