import { getStore } from "@/lib/store";
import { verifiedTwilioForm } from "@/lib/server/twilio-form";
import { registerWebhookReceipt } from "@/lib/webhooks/idempotency";

export async function POST(request: Request) {
  try {
    const form = await verifiedTwilioForm(request);
    const commitmentId = new URL(request.url).searchParams.get("commitmentId");
    if (!commitmentId) return new Response(null, { status: 400 });
    const eventId = `${form.MessageSid ?? commitmentId}:${form.MessageStatus ?? "unknown"}`;
    if (!(await registerWebhookReceipt("twilio-message", eventId))) return new Response(null, { status: 204 });
    if (["sent", "delivered"].includes(form.MessageStatus)) {
      const store = getStore();
      const snapshot = await store.getSnapshot();
      if (snapshot.commitment?.id === commitmentId && snapshot.commitment.status === "VERBALLY_CONFIRMED") {
        await store.markRecapSent(commitmentId, form.MessageSid);
      }
    }
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
}
