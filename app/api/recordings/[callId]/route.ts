import { requireOperator } from "@/lib/server/auth";
import { getStore } from "@/lib/store";
import { isTwilioConfigured } from "@/lib/providers/twilio";

export async function GET(_request: Request, context: { params: Promise<{ callId: string }> }) {
  try {
    await requireOperator();
    const { callId } = await context.params;
    const snapshot = await getStore().getSnapshot();
    const evidence = snapshot.evidence;
    if (!evidence || evidence.callId !== callId) return new Response("Not found", { status: 404 });
    if (!isTwilioConfigured()) return new Response("Demo recording unavailable", { status: 404 });
    const call = snapshot.calls.find((item) => item.id === callId);
    if (!call?.twilioCallSid) return new Response("Not found", { status: 404 });

    const auth = Buffer.from(`${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    if (!evidence.storagePath) return new Response("Recording source unavailable", { status: 404 });
    const recording = await fetch(evidence.storagePath, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!recording.ok) return new Response("Recording unavailable", { status: 502 });
    return new Response(recording.body, {
      headers: {
        "Content-Type": recording.headers.get("content-type") ?? "audio/mpeg",
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
}
