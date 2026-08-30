import type { CallStatus } from "@/lib/domain/types";
import { verifiedTelnyxForm } from "@/lib/providers/telnyx";
import { sendCommitmentRecap } from "@/lib/services/verification";
import { getStore } from "@/lib/store";
import { registerWebhookReceipt } from "@/lib/webhooks/idempotency";

export const runtime = "nodejs";

const statusMap: Record<string, CallStatus> = {
  queued: "QUEUED",
  initiated: "QUEUED",
  ringing: "RINGING",
  "in-progress": "IN_PROGRESS",
  answered: "IN_PROGRESS",
  completed: "COMPLETED",
  busy: "FAILED",
  failed: "FAILED",
  "no-answer": "FAILED",
  canceled: "FAILED",
};

export async function POST(request: Request) {
  let form: Record<string, string>;
  try {
    form = await verifiedTelnyxForm(request);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const callId = new URL(request.url).searchParams.get("callId");
    if (!callId) return new Response(null, { status: 400 });

    const eventId = `${form.CallSid ?? callId}:${form.CallStatus ?? "unknown"}`;
    if (!(await registerWebhookReceipt("telnyx-call", eventId))) {
      return new Response(null, { status: 204 });
    }

    const status = statusMap[form.CallStatus ?? ""];
    if (!status) return new Response(null, { status: 204 });

    await getStore().updateCall(callId, {
      status,
      provider: "TELNYX",
      providerCallId: form.CallSid ?? null,
      failureReason: status === "FAILED" ? (form.CallStatus ?? "failed") : null,
    });
    if (status === "COMPLETED") await sendCommitmentRecap(callId);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", message: "Telnyx status webhook failed", error: String(error) }),
    );
    return new Response(null, { status: 204 });
  }
}
