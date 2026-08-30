import { acceptRealtimeCall, unwrapOpenAIWebhook } from "@/lib/providers/openai-realtime";
import { getStore } from "@/lib/store";
import { registerWebhookReceipt } from "@/lib/webhooks/idempotency";
import type { CallAttempt, OperationSnapshot } from "@/lib/domain/types";

export const runtime = "nodejs";

interface IncomingCallEvent {
  type: string;
  data?: {
    call_id?: string;
    sip_headers?: Array<{ name: string; value: string }>;
  };
}

function headerValue(event: IncomingCallEvent, name: string): string | null {
  return (
    event.data?.sip_headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())
      ?.value ?? null
  );
}

function digits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * A leg Volta dialled carries X-Volta-Call-Id. A cold call — the number handed
 * to a judge, or a dispatcher ringing back — carries nothing, so the operation
 * is bound here instead of dropping the call.
 */
async function resolveInboundCall(
  event: IncomingCallEvent,
  snapshot: OperationSnapshot,
): Promise<CallAttempt> {
  const store = getStore();
  const from = headerValue(event, "From") ?? "";
  const fromDigits = digits(from);
  const carrier = fromDigits
    ? snapshot.carriers.find((item) => digits(item.phoneE164) === fromDigits)
    : undefined;

  const call = await store.createCall({
    operationId: snapshot.operation.id,
    carrierId: carrier?.id ?? null,
    mode: "INBOUND",
  });
  await store.addEvent({
    operationId: snapshot.operation.id,
    callId: call.id,
    type: "inbound.unattributed",
    severity: carrier ? "SUCCESS" : "WARNING",
    summary: carrier
      ? `Inbound SIP call matched to ${carrier.name}`
      : "Inbound SIP call from an unrecognised number; the mandate still governs the conversation",
    payload: { from: from || null, carrierId: carrier?.id ?? null },
  });
  return call;
}

export async function POST(request: Request) {
  const body = await request.text();
  try {
    const event = (await unwrapOpenAIWebhook(body, request.headers)) as IncomingCallEvent;
    const webhookId = request.headers.get("webhook-id");
    if (webhookId && !(await registerWebhookReceipt("openai", webhookId))) {
      return new Response(null, { status: 200 });
    }
    if (event.type !== "realtime.call.incoming" || !event.data?.call_id) {
      return new Response(null, { status: 200 });
    }

    const store = getStore();
    const snapshot = await store.getSnapshot();
    const callId = headerValue(event, "X-Volta-Call-Id");
    const known = callId ? snapshot.calls.find((item) => item.id === callId) : undefined;
    const call = known ?? (await resolveInboundCall(event, snapshot));
    const carrier = snapshot.carriers.find((item) => item.id === call.carrierId);

    await acceptRealtimeCall(event.data.call_id, snapshot, call, carrier);
    await store.updateCall(call.id, {
      status: "IN_PROGRESS",
      openaiCallId: event.data.call_id,
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", message: "OpenAI webhook failed", error: String(error) }),
    );
    return Response.json({ error: "Invalid webhook" }, { status: 400 });
  }
}
