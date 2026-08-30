import { dialSipTexml, hangupTexml, verifiedTelnyxForm } from "@/lib/providers/telnyx";
import { getStore } from "@/lib/store";
import type { CallAttempt } from "@/lib/domain/types";

export const runtime = "nodejs";

const xml = (body: string) =>
  new Response(body, { headers: { "Content-Type": "text/xml; charset=utf-8" } });

function digits(value: string) {
  return value.replace(/\D/g, "");
}

/**
 * Answers a leg the DID routed to us and hands the media to OpenAI over SIP.
 * An outbound leg arrives with the callId we minted; an inbound one arrives
 * cold, so the operation is bound here and the caller is matched by number.
 */
export async function POST(request: Request) {
  let form: Record<string, string>;
  try {
    form = await verifiedTelnyxForm(request);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const store = getStore();
    const callId = new URL(request.url).searchParams.get("callId");

    if (callId) {
      const snapshot = await store.getSnapshot();
      const call = snapshot.calls.find((item) => item.id === callId);
      if (!call) return xml(hangupTexml("Unknown Volta call"));
      return xml(dialSipTexml(call));
    }

    const snapshot = await store.getSnapshot();
    const fromDigits = digits(form.From ?? "");
    const carrier = snapshot.carriers.find((item) => digits(item.phoneE164) === fromDigits);

    let call: CallAttempt = await store.createCall({
      operationId: snapshot.operation.id,
      carrierId: carrier?.id ?? null,
      mode: "INBOUND",
    });
    call = await store.updateCall(call.id, {
      status: "IN_PROGRESS",
      provider: "TELNYX",
      providerCallId: form.CallSid ?? null,
    });

    await store.addEvent({
      operationId: snapshot.operation.id,
      callId: call.id,
      type: "inbound.identified",
      severity: carrier ? "SUCCESS" : "WARNING",
      summary: carrier
        ? `Inbound PSTN call matched to ${carrier.name}`
        : `Inbound PSTN call from an unrecognised number (${form.From ?? "unknown"})`,
      payload: { carrierId: carrier?.id ?? null, from: form.From ?? null, callSid: form.CallSid ?? null },
    });

    return xml(dialSipTexml(call));
  } catch (error) {
    console.error(
      JSON.stringify({ level: "error", message: "Telnyx voice webhook failed", error: String(error) }),
    );
    return xml(hangupTexml("Volta could not accept this call"));
  }
}
