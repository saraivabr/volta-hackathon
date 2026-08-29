import type { CommitmentStatus } from "./types";

const transitions: Record<CommitmentStatus, CommitmentStatus[]> = {
  PROPOSED: ["VERBALLY_CONFIRMED", "SUPERSEDED", "REJECTED", "ESCALATED"],
  VERBALLY_CONFIRMED: ["RECAP_SENT", "SUPERSEDED", "REJECTED", "VERIFICATION_FAILED"],
  RECAP_SENT: ["EVIDENCE_LINKED", "SUPERSEDED", "VERIFICATION_FAILED"],
  EVIDENCE_LINKED: ["COMMITTED", "SUPERSEDED", "VERIFICATION_FAILED"],
  COMMITTED: ["SUPERSEDED", "ESCALATED"],
  SUPERSEDED: [],
  REJECTED: [],
  VERIFICATION_FAILED: ["EVIDENCE_LINKED", "ESCALATED"],
  ESCALATED: [],
};

export function canTransitionCommitment(from: CommitmentStatus, to: CommitmentStatus): boolean {
  return transitions[from].includes(to);
}

export function transitionCommitment(from: CommitmentStatus, to: CommitmentStatus): CommitmentStatus {
  if (!canTransitionCommitment(from, to)) {
    throw new Error(`Invalid commitment transition: ${from} -> ${to}`);
  }
  return to;
}

