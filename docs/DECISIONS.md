# Volta decision log

## ADR-001 — Executable mandate, not prompt authority

**Decision:** Store commercial and operational authority as deterministic server policy. The model can submit facts through MCP but cannot expand permissions.

**Alternatives:** Prompt-only rules; unrestricted model tool calls.

**Why:** A caller can claim that a manager approved a higher rate. Only server policy is authoritative and auditable.

**Trade-off:** More domain code and explicit state transitions; substantially safer trial-by-fire behavior.

## ADR-002 — WhatsApp voice transport for the hackathon

**Decision:** Use WaCalls to dial consented E.164 WhatsApp accounts and bridge 16 kHz PCM to `gpt-realtime-2.1`.

**Alternatives:** Twilio PSTN/SIP; browser-to-browser audio.

**Why:** Twilio provisioning was unavailable to the team. Browser-only audio does not meet the challenge. WaCalls produces real calls to phones and keeps the demo executable with the available infrastructure.

**Trade-off:** WhatsApp Web is unofficial and is not PSTN. The jury may interpret “phone network” narrowly; we disclose this risk instead of disguising it.

## ADR-003 — Realtime conversation plus MCP tools

**Decision:** Use one Realtime session per call with remote MCP tools for context, offers, booking, changes and handoff.

**Alternatives:** Separate STT → text model → TTS pipeline; parsing only after the call.

**Why:** Realtime handles barge-in and short conversational turns while MCP keeps system state synchronized mid-call.

**Trade-off:** Event correlation and final-transcript idempotency are required.

## ADR-004 — Commitment state machine

**Decision:** A booking progresses through `PROPOSED → VERBALLY_CONFIRMED → RECAP_SENT → EVIDENCE_LINKED → COMMITTED`.

**Alternatives:** One LLM extraction marked as booked; transcript-only evidence.

**Why:** A spoken price can be corrected seconds later. A commitment must survive policy revalidation, written recap and audio verification.

**Trade-off:** The UI may show a pending commitment after the call while evidence is processed; it never invents completion.

## ADR-005 — Record the PCM relay

**Decision:** Mix the audio heard by both sides into a timed 16 kHz WAV, upload it to a private bucket and diarize it asynchronously.

**Alternatives:** Trust Realtime transcript timestamps; synthetic evidence; provider recording.

**Why:** WaCalls has no provider recording callback. Capturing at the relay gives Volta an auditable source tied to the actual call.

**Trade-off:** The MVP stores mono mixed audio, so diarization rather than channel identity resolves the confirming speaker.

## ADR-006 — Browser media takeover

**Decision:** On escalation, establish the operator microphone bridge first, then detach GPT without ending the WhatsApp call.

**Alternatives:** Hang up and redial; dial the operator as a third PSTN conference participant.

**Why:** Twilio is unavailable, and the challenge forbids losing the live conversation.

**Trade-off:** The operator must grant microphone access on the demo laptop and stay on the same reachable network path as WaCalls.

## ADR-007 — Snapshot plus append-only audit table

**Decision:** Keep one optimistic-concurrency snapshot for the single-operation MVP and append every generated ledger event to a separate immutable table.

**Alternatives:** Fully normalized event-sourced domain; memory-only demo state.

**Why:** Snapshot reads make the command center simple while the ledger preserves the technical-defense trail.

**Trade-off:** This is deliberately single-operation and not a multi-tenant logistics platform.

## ADR-008 — Persistent Azure VPS for WaCalls

**Decision:** Run the stateful WhatsApp relay on a minimal Azure burstable VM, with Caddy TLS, `systemd` restart policy, a static public IP and a constrained UDP range for browser takeover.

**Alternatives:** Keep the relay on the demo Mac through a temporary Cloudflare tunnel; deploy it inside a serverless function.

**Why:** The WhatsApp device session and long-lived Realtime/WebRTC sockets require persistent storage and a long-running process. Serverless execution does not fit that lifecycle, and a laptop tunnel is not operationally durable.

**Trade-off:** The VPS becomes a small always-on infrastructure cost and must receive operating-system security updates.

## ADR-009 — Telnyx PSTN as the primary transport, WhatsApp as the fallback

**Decision:** Carry the voice leg over Telnyx (TeXML) and hand the media to the OpenAI Realtime SIP endpoint with `<Dial><Sip>`. `VOLTA_VOICE_TRANSPORT` selects `telnyx`, `whatsapp` or `twilio` behind one dial interface.

**Alternatives:** Twilio (account verification unavailable to the team); a self-hosted Asterisk/FreeSWITCH B2BUA on the existing Azure VPS; WhatsApp Web alone.

**Why:** The challenge requires calls over an actual phone network. Telnyx is a licensed carrier reachable from any phone, and OpenAI already accepts the media over SIP, so no bridge of our own is needed. A self-hosted SIP server would still have required a trunk and would have consumed the remaining build time. WhatsApp Web survives as a rehearsed fallback rather than the primary claim.

**Trade-off:** The trial account cannot dial Brazil, so outbound is limited to US, MX, CA and ES. Inbound is unrestricted, which is what the adversarial evaluation depends on. Upgrading the account removes the outbound limit without touching the code.

## ADR-010 — Inbound calls bind to the operation without a correlation header

**Decision:** When `realtime.call.incoming` arrives without `X-Volta-Call-Id`, create an `INBOUND` call against the current operation, match the caller by number when possible and continue under the mandate.

**Alternatives:** Reject the call (the previous behaviour); restrict inbound to an allowlist of known carrier numbers.

**Why:** The adversarial evaluation has a judge dialling from their own phone. Rejecting an unknown caller failed the single most heavily weighted moment of the demo, and an allowlist cannot be populated in advance with a number nobody knows yet.

**Trade-off:** An unrecognised caller reaches the agent. Authority is unaffected — the mandate engine still governs every offer, change and commitment — and the uncertain identity is written to the ledger as a warning.
