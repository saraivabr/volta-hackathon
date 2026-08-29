import twilio from "twilio";
import { getStore } from "@/lib/store";
import { dialAgentLeg } from "@/lib/providers/twilio";
import { verifiedTwilioForm } from "@/lib/server/twilio-form";
import { publicBaseUrl } from "@/lib/server/secrets";

export async function POST(request: Request) {
  try {
    const form = await verifiedTwilioForm(request);
    const store = getStore();
    const snapshot = await store.getSnapshot();
    const carrier = snapshot.carriers.find((item) => item.phoneE164 === form.From);
    const call = await store.createCall({
      operationId: snapshot.operation.id,
      carrierId: carrier?.id ?? null,
      mode: "INBOUND",
    });
    await store.updateCall(call.id, {
      status: "IN_PROGRESS",
      twilioCallSid: form.CallSid ?? null,
    });
    const agentLeg = await dialAgentLeg(call);
    await store.updateCall(call.id, { twilioAgentCallSid: agentLeg.sid });

    const response = new twilio.twiml.VoiceResponse();
    const dial = response.dial();
    dial.conference(
      {
        record: "record-from-start",
        recordingStatusCallback: `${publicBaseUrl()}/api/twilio/recordings?callId=${call.id}`,
      },
      call.conferenceName,
    );
    return new Response(response.toString(), { headers: { "Content-Type": "text/xml" } });
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
}

