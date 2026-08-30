import { winner } from "@/lib/domain/policy";
import { getStore } from "@/lib/store";
import { dialHumanTakeover } from "@/lib/providers/twilio";
import { dialVoiceCall, isVoiceConfigured, voiceProviderTag, voiceTransport } from "@/lib/providers/voice";
import { referCallToOperator } from "@/lib/providers/telnyx";

const demoOffers = [
  { carrierId: "carrier-azul", amount: 8900, pickupDate: "2026-09-03", pickupTime: "11:00" },
  { carrierId: "carrier-rutapac", amount: 8500, pickupDate: "2026-09-03", pickupTime: "10:00" },
  { carrierId: "carrier-manzanillo", amount: 8200, pickupDate: "2026-09-04", pickupTime: "09:00" },
];

export async function startMarketScan(operationId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot(operationId);
  const calls = await Promise.all(
    snapshot.carriers.map((carrier) =>
      store.createCall({ operationId, carrierId: carrier.id, mode: "QUOTE" }),
    ),
  );

  if (isVoiceConfigured() && process.env.VOLTA_DEMO_MODE !== "true") {
    await Promise.all(
      calls.map(async (call) => {
        const carrier = snapshot.carriers.find((item) => item.id === call.carrierId)!;
        try {
          const legs = await dialVoiceCall(call, carrier);
          await store.updateCall(call.id, {
            status: "RINGING",
            twilioCallSid: legs.carrierCallSid,
            twilioAgentCallSid: legs.agentCallSid,
            provider: voiceProviderTag(),
            providerCallId: legs.carrierCallSid,
          });
        } catch (error) {
          await store.updateCall(call.id, { status: "FAILED", failureReason: String(error) });
        }
      }),
    );
  } else {
    await Promise.all(
      calls.map(async (call, index) => {
        await store.updateCall(call.id, { status: "COMPLETED" });
        const fixture = demoOffers[index];
        await store.recordOffer({
          operationId,
          carrierId: fixture.carrierId,
          callId: call.id,
          amount: fixture.amount,
          currency: "MXN",
          pickupDate: fixture.pickupDate,
          pickupTime: fixture.pickupTime,
        });
        await store.finalizeCallBrief(call.id);
      }),
    );
    await store.addEvent({
      operationId,
      type: "demo.simulated",
      severity: "WARNING",
      summary: "Market scan simulated because Twilio is not configured",
    });
  }
  return store.getSnapshot(operationId);
}

export async function startSingleQuoteCall(operationId: string, carrierId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot(operationId);
  const carrier = snapshot.carriers.find((item) => item.id === carrierId);
  if (!carrier) throw new Error("Carrier not found");
  if (!isVoiceConfigured() || process.env.VOLTA_DEMO_MODE === "true") {
    throw new Error("Live telephony is not configured");
  }

  const call = await store.createCall({ operationId, carrierId, mode: "QUOTE" });
  try {
    const legs = await dialVoiceCall(call, carrier);
    await store.updateCall(call.id, {
      status: "RINGING",
      twilioCallSid: legs.carrierCallSid,
      twilioAgentCallSid: legs.agentCallSid,
      provider: voiceProviderTag(),
      providerCallId: legs.carrierCallSid,
    });
  } catch (error) {
    await store.updateCall(call.id, { status: "FAILED", failureReason: String(error) });
    throw error;
  }
  return store.getSnapshot(operationId);
}

export async function bookWinningOffer(operationId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot(operationId);
  const selected = winner(snapshot);
  if (!selected) throw new Error("No eligible offer is available");
  const carrier = snapshot.carriers.find((item) => item.id === selected.carrierId)!;
  const call = await store.createCall({ operationId, carrierId: carrier.id, mode: "BOOKING" });

  if (isVoiceConfigured() && process.env.VOLTA_DEMO_MODE !== "true") {
    const legs = await dialVoiceCall(call, carrier);
    await store.updateCall(call.id, {
      status: "RINGING",
      twilioCallSid: legs.carrierCallSid,
      twilioAgentCallSid: legs.agentCallSid,
      provider: voiceProviderTag(),
      providerCallId: legs.carrierCallSid,
    });
  } else {
    await store.updateCall(call.id, { status: "COMPLETED" });
    const staged = await store.stageBooking(operationId, selected.id, call.id);
    await store.confirmBooking(staged.commitment.id, staged.confirmationToken);
    await store.markRecapSent(staged.commitment.id, "SM_SIMULATED_NO_AUDIO");
    // A simulated call produces no recording, so there is nothing to link and
    // the commitment stays short of COMMITTED. Manufacturing an audio segment
    // here would put an unfalsifiable claim on the one surface whose whole
    // purpose is to be checkable.
    await store.addEvent({
      operationId,
      callId: call.id,
      type: "demo.booking_simulated",
      severity: "WARNING",
      summary:
        "Booking confirmation simulated because live telephony is not configured; no audio evidence exists, so this commitment stops at RECAP_SENT",
    });
    await store.finalizeCallBrief(call.id);
  }
  return store.getSnapshot(operationId);
}

export async function takeOver(operationId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot(operationId);
  const escalation = snapshot.escalation;
  if (!escalation) throw new Error("No open escalation");
  const call = snapshot.calls.find((item) => item.id === escalation.callId);
  if (!call) throw new Error("Escalated call not found");
  await store.updateEscalation(escalation.id, "DIALING");
  if (isVoiceConfigured() && process.env.VOLTA_DEMO_MODE !== "true") {
    switch (voiceTransport()) {
      case "whatsapp":
        throw new Error("WhatsApp live takeover requires the browser media bridge");
      case "telnyx": {
        if (!call.openaiCallId) throw new Error("The escalated call has no live realtime session");
        await referCallToOperator(call.openaiCallId);
        break;
      }
      default:
        await dialHumanTakeover(call);
    }
  } else {
    await store.updateEscalation(escalation.id, "CONNECTED");
  }
  return store.getSnapshot(operationId);
}

export async function simulateInboundException(operationId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot(operationId);
  const carrierId = snapshot.commitment?.carrierId ?? "carrier-rutapac";
  const call = await store.createCall({ operationId, carrierId, mode: "INBOUND" });
  await store.updateCall(call.id, { status: "IN_PROGRESS" });
  await store.addEvent({
    operationId,
    callId: call.id,
    type: "change.blocked",
    severity: "DANGER",
    summary: "Truck breakdown; carrier requested Friday pickup",
    payload: { from: snapshot.operation.pickupDate, to: "2026-09-04" },
  });
  await store.createEscalation(
    operationId,
    call.id,
    "Truck unavailable for the committed pickup day",
    "Move pickup from Thursday to Friday at 09:00",
  );
  await store.addEvent({
    operationId,
    callId: call.id,
    type: "demo.inbound_simulated",
    severity: "WARNING",
    summary: "Inbound exception simulated for adversarial demo",
  });
  return store.getSnapshot(operationId);
}
