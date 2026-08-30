import { z } from "zod";
import { requireOperator } from "@/lib/server/auth";
import { apiError, ok } from "@/lib/server/http";
import { getStore } from "@/lib/store";
import { startWhatsAppBrowserTakeover } from "@/lib/providers/wacalls";

const schema = z.object({ sdpOffer: z.string().min(20).max(200_000) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireOperator();
    const { id } = await context.params;
    const { sdpOffer } = schema.parse(await request.json());
    const store = getStore();
    const snapshot = await store.getSnapshot(id);
    if (!snapshot.escalation) throw new Error("No open escalation");
    const call = snapshot.calls.find((item) => item.id === snapshot.escalation?.callId);
    if (!call?.providerCallId || call.provider !== "WHATSAPP") {
      throw new Error("The escalated WhatsApp call is no longer available");
    }
    await store.updateEscalation(snapshot.escalation.id, "DIALING");
    const result = await startWhatsAppBrowserTakeover(call.providerCallId, sdpOffer);
    return ok({ sdpAnswer: result.sdp_answer, snapshot: await store.getSnapshot(id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireOperator();
    const { id } = await context.params;
    const store = getStore();
    const snapshot = await store.getSnapshot(id);
    if (!snapshot.escalation || snapshot.escalation.status !== "DIALING") {
      throw new Error("No browser takeover is waiting for confirmation");
    }
    await store.updateEscalation(snapshot.escalation.id, "CONNECTED");
    return ok(await store.getSnapshot(id));
  } catch (error) {
    return apiError(error);
  }
}
