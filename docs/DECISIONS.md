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

## ADR-011 — Resolve the recording peak on serialization, not per sample

**Decision:** Sum both sides of the call into the mono timeline unclamped and scale once, on WAV serialization, if the peak exceeds full scale.

**Alternatives:** Keep the per-sample clamp; lower the per-side gain until two speakers cannot overshoot.

**Why:** Each side was attenuated then clamped as it was mixed, so any overlap flat-topped — and overlap is precisely what barge-in produces. A clipped confirmation is poor input for diarization, which is the step that turns a spoken yes into linked audio evidence. Lowering the gain instead would have made quiet calls unusable.

**Trade-off:** A single loud transient scales the whole recording down. That is recoverable; clipping is not.

## ADR-012 — A simulated booking may not present itself as verified

**Decision:** When live telephony is unavailable, a booking stops at `RECAP_SENT` and the ledger records that no audio evidence exists.

**Alternatives:** Keep the placeholder segment so the demo shows a complete chain; label the placeholder as simulated in the UI.

**Why:** The commitment ledger is the one surface whose whole purpose is to be checkable. Manufacturing a timestamp there asserts something nobody can falsify, and a single judge pressing play would cost more than the missing chain is worth.

**Trade-off:** The demo cannot show a fully green commitment without a real recorded call. That is the honest state of the system, and the gate visibly holding is the stronger claim.

## ADR-013 — Every field the mandate shows is enforced by the engine

**Decision:** `maximumCounters` and `negotiateRate` are evaluated server-side on each recorded offer, alongside the rate ceiling, pickup window and accessorials. A revision past the authorised budget is refused and the agent is told to stop negotiating.

**Alternatives:** Leave both to the prompt, as they were; drop them from the operator's briefing.

**Why:** The operator sets seven limits in the briefing, and the pitch is that a limit is server policy rather than a request to the model. Two of them were reaching the model as text and nothing more — `negotiateRate` was read by nothing at all. A jury asking what stops the third counter-offer deserves an answer that is not "the prompt asks it nicely."

**Trade-off:** A retried or echoed tool call would otherwise burn a counter, so an offer restating the standing terms returns the existing revision instead of opening a new one.

## ADR-014 — Consent is recognised by shape, not by exact phrase

**Decision:** Accept an answer that opens on an affirmative, carries no qualifier and stays short. Reject anything containing a walk-back, hedge or condition, however affirmative it sounds.

**Alternatives:** Keep the closed list of four exact phrases; hand the judgement to the model.

**Why:** The previous matcher accepted `sí`, `confirmo`, `de acuerdo` and `correcto` and nothing else — a dispatcher saying "sí señor" or "correcto, procedemos" was refused. That reads as a broken agent rather than a careful one, and the same matcher locates the confirming segment in the recording, so a natural yes also produced no audio evidence. Widening the vocabulary while holding the shape keeps "sí, pero cambia el horario" and "sí, mi jefe ya aprobó" out.

**Trade-off:** A yes buried in a long sentence is refused. Asking again costs a turn; accepting an argument as consent costs the commitment.

## ADR-015 — Acknowledgement is not agreement

**Decision:** A confirmation must contain an actual affirmative — `sí`, `correcto`, `confirmo`, `de acuerdo`. Back-channel — `okay`, `vale`, `listo`, `perfecto`, `adelante` — is allowed around one but never counts as one on its own. Evidence may not be attached to a commitment still in `PROPOSED`.

**Alternatives:** Keep the wider opener list; let the model decide whether an utterance was consent.

**Why:** Widening the vocabulary to stop refusing real dispatchers went one step too far and swept in acknowledgement. On a live call the recording pipeline then anchored audio evidence to the counterparty saying "Okay" eighty-three seconds in, on a booking nobody had confirmed. Nothing was committed, because the recap had not been sent — but `markRecapSent` completes the chain whenever evidence already exists, so the next step would have committed a booking on the strength of a filler word.

**Trade-off:** A dispatcher whose only answer is "listo" has to be asked again. That costs a turn. The alternative cost a commitment nobody made.

## ADR-016 — Renegotiation retires the agreement before replacing it

**Decision:** When the operator changes the briefing after a carrier has agreed, `Renegotiate` supersedes the standing commitment, clears its evidence, marks the operation `AT_RISK` and calls the same carrier back in a dedicated call mode that states what changed and negotiates under the new mandate.

**Alternatives:** Amend the existing commitment in place; open a second commitment beside the first.

**Why:** The challenge asks for a callback when circumstances change, without exceeding the mandate. An agreement made under an authority that no longer exists cannot keep presenting itself as live, and its audio evidence proves consent to terms nobody agreed to any more. Amending in place would leave the ledger unable to say which terms were confirmed when.

**Trade-off:** The operation drops out of a committed state the moment renegotiation starts, before the new terms exist. That gap is the honest position: for those minutes there is genuinely no agreement in force.

## ADR-017 — Serialise writes inside the process, keep the version check for outside it

**Decision:** Queue mutations per store instance so a process never races itself, and retry a lost version race with exponential backoff and jitter instead of an immediate tight loop.

**Alternatives:** Raise the retry count; move each concern to its own row and drop the single-snapshot design.

**Why:** Three carriers are negotiated at once and every live call streams transcript turns, offers and events into one snapshot. Measured on the store, seventy-five concurrent turns kept four: each writer re-read the same version, collided, and re-read it again with no delay — a livelock that silently discarded the evidence surface the whole product rests on. Queuing removes the contention a process creates against itself, which is nearly all of it; the version check still guards a genuinely concurrent writer in another instance.

**Trade-off:** Mutations no longer overlap within a process, so a burst is bounded by read-plus-write latency rather than running in parallel. Losing throughput is recoverable. Losing the transcript is not.

## ADR-018 — The engine escalates; it does not ask the model to

**Decision:** When the mandate engine blocks an operational change it opens the escalation itself. The tool result tells the agent a human is already on the way rather than instructing it to call `request_handoff`.

**Alternatives:** Keep returning `escalation_required` and rely on the agent to act on it.

**Why:** Escalating is the most safety-critical action in the system and it was the one thing left to the model's discretion — a refusal was recorded, an instruction was returned, and if the model never called the tool the blocked change sat there with nobody watching. That inverts the trust boundary the rest of the design holds. Both paths arriving is now the normal case, so a second `request_handoff` joins the live escalation instead of resetting a human already on the line back to `OPEN`.

**Trade-off:** A blocked change always raises a human, including ones an operator might have waved through. Escalating a change nobody minded costs a phone call; missing one costs the commitment.

## ADR-019 — Delegation ends at the booking, not at the quotes

**Decision:** Once every quote call has settled, the standing winner is booked without an operator pressing anything. If nothing the market returned fits the mandate, a human is called instead.

**Alternatives:** Keep the operator in the loop for the booking call, as a review step.

**Why:** The ranking was already deterministic and server-side; only the trigger was manual, which meant an operator who closed the laptop — the thing the pitch tells them to do — came back to three finished quotes and no truck. The review step it offered was illusory: the winner is chosen by policy, so there was nothing for a human to weigh, only something for them to be late for.

**Trade-off:** An operator who wanted to intervene between quoting and booking now has to renegotiate afterwards instead. The empty-market case is the one that still stops and asks, because that is a decision policy genuinely cannot make.

## ADR-020 — The type floor is set by the back of the room

**Decision:** Replace every raw size, gap, duration and shadow in the stylesheet with tokens, and raise the smallest text to 10px with most labels at 11.5px. Add a visible focus ring and honour `prefers-reduced-motion`.

**Alternatives:** Keep tuning individual rules as they are noticed; treat the dense small type as the design's character.

**Why:** Forty-nine font declarations were 10px or under and two were 6px, across twenty-six unrelated spacing values. On the laptop it authored itself on that reads as density; projected in a room it is unreadable, and the first person to say so was an operator asking for the audit log to be bigger — the log being the surface that carries the timestamps and refusals a jury is meant to check. A scale fixes the whole surface at once instead of the one panel somebody complained about.

**Trade-off:** Less fits above the fold, and the escalation drawer grew enough to cover the audit stream, so it moved beside that column and now collapses itself once a human is connected. Density bought back nothing that being unreadable did not cost.

## ADR-021 — The recap leaves by every channel that is configured

**Decision:** Send the written recap over the text transport and, when the carrier has an address and email is configured, by email as well. One delivery is enough to advance the commitment; none leaves it at `VERBALLY_CONFIRMED` and says so.

**Alternatives:** Keep a single channel per transport; treat email as a later concern.

**Why:** The challenge asks for a written recap by SMS *or* email, and the recap is one half of the dual verification a commitment rests on. A handset that is off, a mistyped number and a message that never lands all fail silently and identically, and the previous code took the first channel's success as the whole answer. Two records of the same terms cost one extra request.

**Trade-off:** A partial delivery still advances the commitment, with the failed channel named in the ledger rather than retried. Blocking on the weaker channel would fail commitments that are genuinely evidenced.

## ADR-022 — The handoff number belongs to the briefing

**Decision:** The operation carries the number a handoff dials, editable in the briefing, with the environment variable as a fallback.

**Alternatives:** Keep it in the environment only.

**Why:** Who covers an escalation changes by shift and by operation, and the person on duty cannot edit an environment variable or redeploy to answer a call. Leaving it empty keeps the escalation in the dashboard, which is a deliberate choice rather than a missing one.

**Trade-off:** A number typed into a briefing is validated as E.164 and nothing more; a wrong-but-valid number sends the handoff somewhere nobody is waiting. The ledger records which number was dialled.
