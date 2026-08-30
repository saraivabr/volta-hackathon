# Volta

Volta turns logistics phone conversations into verified operational commitments while enforcing a human-authored mandate.

## Stack

- Next.js 16 / TypeScript / Tailwind CSS
- OpenAI Realtime `gpt-realtime-2.1` with final input/output transcription events
- WaCalls / WhatsApp Web voice transport with bidirectional 16 kHz PCM and paced playback
- Azure VPS with Caddy TLS, persistent WhatsApp session and constrained WebRTC UDP media
- Stateless MCP tool endpoint for policy-controlled actions
- Deterministic mandate, market-ranking and commitment engines
- Supabase Postgres snapshot persistence, append-only audit rows, private recording Storage and RLS

Live command center: [volta-hackathon.vercel.app](https://volta-hackathon.vercel.app)

## Architecture

```mermaid
flowchart LR
  UI[Next.js command center] --> API[Volta control API]
  API --> DB[(Supabase)]
  API --> WA[WaCalls service]
  WA --> PHONE[Consented WhatsApp phone calls]
  WA <--> RT[gpt-realtime-2.1]
  RT --> MCP[Remote MCP tools]
  MCP --> POLICY[Mandate and commitment engines]
  POLICY --> DB
  RT --> TRANSCRIPT[Final agent and counterparty turns]
  TRANSCRIPT --> DB
  WA --> WAV[Timed 16 kHz WAV]
  WAV --> DB
  DB --> DIARIZE[gpt-4o-transcribe-diarize]
  DIARIZE --> EVIDENCE[Audio timestamp evidence]
  UI --> HANDOFF[Browser microphone takeover]
  HANDOFF <--> WA
```

## Local run

1. Copy `.env.example` to `.env.local` and fill the non-secret configuration. Keep secrets out of Git.
2. Set `VOLTA_DEMO_MODE=true` to run the UI flow with clearly labelled simulated calls, or configure WaCalls for real consented WhatsApp calls.
3. Run `pnpm dev` and enter the configured `DEMO_ACCESS_CODE`. In development, the fallback code is `volta`.

The OpenAI key must be supplied through `OPENAI_API_KEY`. The ignored `Sem Título 14.txt` file is never read or bundled by the application.

## WhatsApp voice setup

1. Apply `supabase/migrations/202608290001_volta_core.sql`.
2. Build the service with `pnpm wacalls:build` and expose it behind a persistent HTTPS origin. The repeatable Azure layout is documented in [`deploy/azure`](deploy/azure/README.md).
3. Set `VOLTA_VOICE_TRANSPORT=whatsapp`, `WACALLS_BASE_URL`, matching API/relay secrets and an exact `WACALLS_ALLOWED_PHONES` consent allowlist.
4. Start the service, open the command center and scan its QR from WhatsApp → Linked devices.
5. Add all variables from `.env.example` to Vercel. `APP_BASE_URL` must be the public HTTPS origin.

WaCalls uses an unofficial WhatsApp Web transport. Use a dedicated account, explicit participant consent and the exact phone allowlist. It is not PSTN; that limitation and the unavailable Twilio alternative are recorded in the decision log.

## Authority and decisions

- Realtime transcription is evidence/guidance; it never grants authority.
- MCP tools submit structured facts to the backend.
- The mandate engine decides offer eligibility, corrections and unauthorized changes.
- The market engine selects only among eligible offers.
- Every final transcript turn and operational decision is persisted, correlated to the call and shown in the UI.
- A commitment still requires explicit confirmation, written recap and linked evidence.
- Inbound calls from allowlisted carriers are correlated automatically; an unauthorized change opens a live browser-microphone takeover without ending the call.

## Verification

```bash
pnpm check
pnpm exec playwright install chromium
pnpm test:e2e
```

The UI never labels an outcome committed until explicit verbal confirmation, a written recap and timestamped audio evidence all exist.

## Hackathon deliverables

- [Presentation](docs/PRESENTATION.md)
- [Live demo script](docs/DEMO_SCRIPT.md)
- [Architecture diagram and trust boundaries](docs/ARCHITECTURE.md)
- [Decision log](docs/DECISIONS.md)
- [Public production command center](https://volta-hackathon.vercel.app)

## Honest runtime limits

- WhatsApp calls are real phone calls to consented E.164 accounts, but the transport is not PSTN.
- Three-device parallel QA requires three consented numbers in `WACALLS_ALLOWED_PHONES`; automated tests never dial real people.
- Production WaCalls now runs persistently on Azure; operational availability still depends on the VPS, Caddy and the unofficial WhatsApp Web session remaining healthy.
