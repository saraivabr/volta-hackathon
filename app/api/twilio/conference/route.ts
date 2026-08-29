import { getStore } from "@/lib/store";
import { twilioClient } from "@/lib/providers/twilio";
import { verifiedTwilioForm } from "@/lib/server/twilio-form";
import { registerWebhookReceipt } from "@/lib/webhooks/idempotency";

export async function POST(request: Request) {
  try {
    const form = await verifiedTwilioForm(request);
    const url = new URL(request.url);
    const callId = url.searchParams.get("callId");
    const role = url.searchParams.get("role");
    if (!callId) return new Response(null, { status: 400 });
    const eventId = `${form.ConferenceSid ?? callId}:${form.CallSid ?? "none"}:${form.StatusCallbackEvent ?? "unknown"}:${role ?? "unknown"}`;
    if (!(await registerWebhookReceipt("twilio-conference", eventId))) return new Response(null, { status: 204 });
    if (role === "human" && form.StatusCallbackEvent === "participant-join") {
      const store = getStore();
      const snapshot = await store.getSnapshot();
      const call = snapshot.calls.find((item) => item.id === callId);
      if (snapshot.escalation) await store.updateEscalation(snapshot.escalation.id, "CONNECTED");
      if (call?.twilioAgentCallSid) {
        await twilioClient().calls(call.twilioAgentCallSid).update({ status: "completed" });
      }
    }
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
}
