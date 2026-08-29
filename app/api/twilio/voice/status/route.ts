import { getStore } from "@/lib/store";
import { sendCommitmentRecap } from "@/lib/services/verification";
import { verifiedTwilioForm } from "@/lib/server/twilio-form";
import { registerWebhookReceipt } from "@/lib/webhooks/idempotency";

const statusMap = {
  queued: "QUEUED",
  initiated: "QUEUED",
  ringing: "RINGING",
  "in-progress": "IN_PROGRESS",
  completed: "COMPLETED",
  busy: "FAILED",
  failed: "FAILED",
  "no-answer": "FAILED",
  canceled: "FAILED",
} as const;

export async function POST(request: Request) {
  try {
    const form = await verifiedTwilioForm(request);
    const url = new URL(request.url);
    const callId = url.searchParams.get("callId");
    const role = url.searchParams.get("role");
    if (!callId) return new Response(null, { status: 400 });
    const eventId = `${form.CallSid ?? callId}:${form.CallStatus ?? "unknown"}:${role ?? "unknown"}`;
    if (!(await registerWebhookReceipt("twilio-call", eventId))) return new Response(null, { status: 204 });
    const status = statusMap[form.CallStatus as keyof typeof statusMap];
    if (status && role === "carrier") {
      await getStore().updateCall(callId, {
        status,
        twilioCallSid: form.CallSid ?? null,
        failureReason: status === "FAILED" ? form.CallStatus : null,
      });
      if (status === "COMPLETED") await sendCommitmentRecap(callId);
    }
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
}
