import { getStore } from "@/lib/store";
import { conferenceTwiml } from "@/lib/providers/twilio";
import { verifiedTwilioForm } from "@/lib/server/twilio-form";

export async function POST(request: Request) {
  try {
    await verifiedTwilioForm(request);
    const url = new URL(request.url);
    const callId = url.searchParams.get("callId");
    const role = url.searchParams.get("role") ?? "carrier";
    if (!callId) return new Response("Missing callId", { status: 400 });
    const snapshot = await getStore().getSnapshot();
    const call = snapshot.calls.find((item) => item.id === callId);
    if (!call) return new Response("Call not found", { status: 404 });
    return new Response(conferenceTwiml(call, role), {
      headers: { "Content-Type": "text/xml; charset=utf-8" },
    });
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
}

