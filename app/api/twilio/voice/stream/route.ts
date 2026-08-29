import { getStore } from "@/lib/store";
import { streamingTwiml } from "@/lib/providers/twilio";
import { verifiedTwilioForm } from "@/lib/server/twilio-form";

export async function POST(request: Request) {
  try {
    await verifiedTwilioForm(request);
    const callId = new URL(request.url).searchParams.get("callId");
    if (!callId) return new Response("Missing callId", { status: 400 });
    const snapshot = await getStore().getSnapshot();
    const call = snapshot.calls.find((item) => item.id === callId);
    if (!call) return new Response("Call not found", { status: 404 });
    return new Response(streamingTwiml(call), {
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Media stream TwiML failed", error: String(error) }));
    return new Response("Forbidden", { status: 403 });
  }
}
