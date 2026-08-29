import { z } from "zod";
import { authorizeRelayRequest } from "@/lib/server/relay-auth";
import { getStore } from "@/lib/store";
import { sendCommitmentRecap } from "@/lib/services/verification";
import { isTranscriptionContextEcho } from "@/lib/domain/transcripts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  callId: z.string().uuid(),
  eventType: z.enum([
    "stream.started",
    "session.created",
    "response.done",
    "stream.stopped",
    "relay.error",
    "call.ringing",
    "call.active",
    "call.ended",
    "transcript.final",
  ]),
  sessionId: z.string().optional(),
  providerCallId: z.string().max(128).optional(),
  detail: z.string().max(500).optional(),
  speaker: z.enum(["AGENT", "COUNTERPARTY"]).optional(),
  itemId: z.string().max(160).optional(),
  transcript: z.string().trim().min(1).max(8_000).optional(),
});

export async function POST(request: Request) {
  try {
    if (!authorizeRelayRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const event = bodySchema.parse(await request.json());
    const store = getStore();
    if (event.eventType === "transcript.final") {
      if (!event.speaker || !event.itemId || !event.transcript) {
        return Response.json({ error: "Transcript payload is incomplete" }, { status: 400 });
      }
      if (isTranscriptionContextEcho(event.transcript)) {
        return new Response(null, { status: 204 });
      }
      await store.recordTranscript({
        operationId: "op-2041",
        callId: event.callId,
        speaker: event.speaker,
        providerItemId: event.itemId,
        text: event.transcript,
      });
      return new Response(null, { status: 204 });
    } else if (event.eventType === "session.created") {
      await store.updateCall(event.callId, {
        status: "IN_PROGRESS",
        openaiCallId: event.sessionId ?? null,
        provider: "WHATSAPP",
        providerCallId: event.providerCallId ?? undefined,
      });
    } else if (event.eventType === "call.ringing") {
      await store.updateCall(event.callId, {
        status: "RINGING",
        provider: "WHATSAPP",
        providerCallId: event.providerCallId ?? undefined,
      });
    } else if (event.eventType === "call.active") {
      await store.updateCall(event.callId, { status: "IN_PROGRESS" });
    } else if (event.eventType === "call.ended" || event.eventType === "stream.stopped") {
      await store.updateCall(event.callId, { status: "COMPLETED" });
      if (event.eventType === "stream.stopped") await sendCommitmentRecap(event.callId);
    } else if (event.eventType === "relay.error") {
      await store.updateCall(event.callId, { status: "FAILED", failureReason: event.detail ?? "Realtime relay error" });
    }
    await store.addEvent({
      operationId: "op-2041",
      callId: event.callId,
      type: `relay.${event.eventType}`,
      severity: event.eventType === "relay.error" ? "DANGER" : "INFO",
      summary: event.detail ?? event.eventType,
      payload: { sessionId: event.sessionId ?? null, providerCallId: event.providerCallId ?? null },
    });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Relay event rejected", error: String(error) }));
    return Response.json({ error: "Invalid relay event" }, { status: 400 });
  }
}
