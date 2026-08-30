import { verifiedTelnyxForm } from "@/lib/providers/telnyx";
import { processRecording } from "@/lib/services/verification";
import { registerWebhookReceipt } from "@/lib/webhooks/idempotency";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let form: Record<string, string>;
  try {
    form = await verifiedTelnyxForm(request);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const callId = new URL(request.url).searchParams.get("callId");
    const recordingUrl = form.RecordingUrl;
    if (!callId || !recordingUrl) return new Response(null, { status: 204 });
    if (!(await registerWebhookReceipt("telnyx-recording", form.RecordingSid ?? recordingUrl))) {
      return new Response(null, { status: 204 });
    }
    await processRecording(callId, recordingUrl);
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", message: "Telnyx recording webhook failed", error: String(error) }),
    );
    return new Response(null, { status: 204 });
  }
}
