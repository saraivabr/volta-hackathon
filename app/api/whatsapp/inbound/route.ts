import { z } from "zod";
import { getStore } from "@/lib/store";
import { authorizeRelayRequest } from "@/lib/server/relay-auth";

export const runtime = "nodejs";

const schema = z.object({
  providerCallId: z.string().min(1).max(160),
  peer: z.string().min(5).max(180),
});

function digits(value: string) {
  return value.replace(/\D/g, "");
}

export async function POST(request: Request) {
  try {
    if (!authorizeRelayRequest(request)) return new Response("Unauthorized", { status: 401 });
    const input = schema.parse(await request.json());
    const store = getStore();
    const snapshot = await store.getSnapshot();
    const existing = snapshot.calls.find(
      (call) => call.provider === "WHATSAPP" && call.providerCallId === input.providerCallId,
    );
    if (existing) return Response.json({ ok: true, data: { callId: existing.id } });
    const peerDigits = digits(input.peer);
    const carrier = snapshot.carriers.find((item) => digits(item.phoneE164) === peerDigits);
    const call = await store.createCall({
      operationId: snapshot.operation.id,
      carrierId: carrier?.id ?? null,
      mode: "INBOUND",
    });
    await store.updateCall(call.id, {
      status: "RINGING",
      provider: "WHATSAPP",
      providerCallId: input.providerCallId,
    });
    await store.addEvent({
      operationId: snapshot.operation.id,
      callId: call.id,
      type: "inbound.identified",
      severity: carrier ? "SUCCESS" : "WARNING",
      summary: carrier ? `Inbound caller matched to ${carrier.name}` : "Inbound caller identity is uncertain",
      payload: { carrierId: carrier?.id ?? null, providerCallId: input.providerCallId },
    });
    if (!carrier) {
      await store.createEscalation(
        snapshot.operation.id,
        call.id,
        "Inbound caller identity could not be verified",
        "Continue the operational conversation with an unrecognized caller",
      );
    }
    return Response.json({ ok: true, data: { callId: call.id } });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Inbound WhatsApp call rejected", error: String(error) }));
    return new Response("Invalid inbound call", { status: 400 });
  }
}
