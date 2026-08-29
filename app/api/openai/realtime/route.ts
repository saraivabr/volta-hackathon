import { acceptRealtimeCall, unwrapOpenAIWebhook } from "@/lib/providers/openai-realtime";
import { getStore } from "@/lib/store";
import { registerWebhookReceipt } from "@/lib/webhooks/idempotency";

export const runtime = "nodejs";

interface IncomingCallEvent {
  type: string;
  data?: {
    call_id?: string;
    sip_headers?: Array<{ name: string; value: string }>;
  };
}

function headerValue(event: IncomingCallEvent, name: string): string | null {
  return event.data?.sip_headers?.find((header) => header.name.toLowerCase() === name.toLowerCase())?.value ?? null;
}

export async function POST(request: Request) {
  const body = await request.text();
  try {
    const event = (await unwrapOpenAIWebhook(body, request.headers)) as IncomingCallEvent;
    const webhookId = request.headers.get("webhook-id");
    if (webhookId && !(await registerWebhookReceipt("openai", webhookId))) {
      return new Response(null, { status: 200 });
    }
    if (event.type !== "realtime.call.incoming" || !event.data?.call_id) return new Response(null, { status: 200 });

    const callId = headerValue(event, "X-Volta-Call-Id");
    if (!callId) return Response.json({ error: "Missing Volta call id" }, { status: 400 });
    const store = getStore();
    const snapshot = await store.getSnapshot();
    const call = snapshot.calls.find((item) => item.id === callId);
    if (!call) return Response.json({ error: "Unknown Volta call" }, { status: 404 });
    const carrier = snapshot.carriers.find((item) => item.id === call.carrierId);

    await acceptRealtimeCall(event.data.call_id, snapshot, call, carrier);
    await store.updateCall(call.id, {
      status: "IN_PROGRESS",
      openaiCallId: event.data.call_id,
    });
    return new Response(null, { status: 200 });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "OpenAI webhook failed", error: String(error) }));
    return Response.json({ error: "Invalid webhook" }, { status: 400 });
  }
}
