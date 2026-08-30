---
marp: true
theme: default
paginate: true
title: Volta — Delegated operations with auditable authority
---

# VOLTA

## Delegate the call. Keep the authority.

Volta turns messy logistics phone conversations into verified operational commitments — or live escalations.

---

# The channel software cannot reach

- Drayage quotes, pickup changes and driver problems still happen by phone.
- What was agreed lives in memory, chat fragments and spreadsheets.
- A transcript records words. Operations need a decision that can be proved and executed.

**Thesis:** the future of voice agents is not sounding human. It is holding authority safely.

---

# The human mandate is executable

The operator defines:

- pickup date and time window;
- target rate and hard ceiling;
- permitted changes and accessorials;
- conditions that require escalation.

The caller cannot expand that mandate. The model cannot override it.

---

# One operation, one verified outcome

`Mandate → 3 calls → offers → eligible winner → booking → recap → audio evidence → commitment`

- Three real calls are dispatched concurrently.
- The cheapest invalid offer loses.
- Only the policy-ranked winner receives the booking call.
- Every correction creates a new revision and supersedes the previous one.

---

# Commitment is a state machine

`PROPOSED → VERBALLY_CONFIRMED → RECAP_SENT → EVIDENCE_LINKED → COMMITTED`

No unqualified “yes”, no commitment.

No written recap, no commitment.

No real audio timestamp, no commitment.

A simulated run stops at `RECAP_SENT`. The gate is the product; faking the last step would forfeit it.

---

# Ugly cases reduce autonomy

- Interruption cancels current speech.
- Contradiction supersedes the old offer.
- False authority is ignored.
- Silence ends safely.
- Unauthorized operational change creates `AT_RISK`.
- The operator takes over the same live call with the accumulated context.

---

# Architecture and judgment

- `gpt-realtime-2.1` owns live Spanish conversation.
- Remote MCP tools submit structured facts.
- The deterministic backend owns authorization, ranking and commitment.
- Telnyx carries the public-network leg; WaCalls carries the consented WhatsApp leg. One dial interface, selected by configuration.
- WaCalls owns PCM recording and browser takeover.
- Supabase owns operation state, private evidence, jobs and append-only audit events.

The transport is configuration, not product. Outbound to Brazil waits on carrier verification; that limit is stated rather than hidden.

---

# What the judge can verify

- three phone calls and auditable quote comparison;
- a booking made only inside the mandate;
- written recap plus real audio timestamp;
- structured call brief and decision trace;
- inbound exception and same-call human takeover;
- a live refusal when the judge tries to exceed authority.

## Give Volta the mandate. Get back a verified commitment — or a live escalation.
