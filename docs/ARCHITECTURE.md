# Volta architecture

```mermaid
flowchart LR
  OP[Human operator] --> UI[Next.js command center]
  UI --> API[Authenticated control API]
  API --> STATE[(Supabase snapshot + append-only ledger)]
  API --> WA[WaCalls voice service]
  WA --> C1[Carrier 1 WhatsApp phone]
  WA --> C2[Carrier 2 WhatsApp phone]
  WA --> C3[Carrier 3 WhatsApp phone]
  WA <--> RT[gpt-realtime-2.1]
  RT --> MCP[Remote MCP tools]
  MCP --> POLICY[Deterministic mandate engine]
  POLICY --> STATE
  WA --> WAV[Mixed 16 kHz WAV]
  WAV --> STORAGE[(Private recording bucket)]
  STORAGE --> ASR[gpt-4o-transcribe-diarize]
  ASR --> EVIDENCE[Canonical confirmation segment]
  EVIDENCE --> STATE
  API --> RECAP[Written WhatsApp recap]
  RECAP --> STATE
  CALLER[Inbound carrier call] --> WA
  POLICY --> ESC[Escalation]
  ESC --> BROWSER[Operator browser microphone bridge]
  BROWSER <--> WA
```

## Trust boundary

The model may listen, speak and submit structured observations. It cannot modify the mandate. Every offer, correction, operational change and booking confirmation is re-evaluated server-side. Ambiguity reduces autonomy.

## Commitment gate

```mermaid
stateDiagram-v2
  [*] --> PROPOSED
  PROPOSED --> VERBALLY_CONFIRMED: explicit canonical yes + valid token
  VERBALLY_CONFIRMED --> RECAP_SENT: written recap accepted by provider
  RECAP_SENT --> EVIDENCE_LINKED: recording segment aligned
  EVIDENCE_LINKED --> COMMITTED
  PROPOSED --> REJECTED
  VERBALLY_CONFIRMED --> SUPERSEDED: corrected terms
  RECAP_SENT --> VERIFICATION_FAILED: no aligned audio
  COMMITTED --> ESCALATED: unauthorized operational change
```

## Runtime ownership

- Vercel owns the command center, authenticated APIs, MCP server and webhooks.
- Supabase owns current operation state, durable jobs, private recordings and append-only audit rows.
- WaCalls owns WhatsApp signaling, bidirectional PCM, Realtime bridging, barge-in and browser takeover.
- The production WaCalls process runs on an Azure VPS behind Caddy; SQLite preserves the paired device and Azure NSG exposes only HTTPS plus the constrained WebRTC UDP range.
- OpenAI Realtime owns the live Spanish conversation; the deterministic backend owns authority.
