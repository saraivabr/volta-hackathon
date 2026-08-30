import { latestOffers, winner } from "@/lib/domain/policy";
import { getStore } from "@/lib/store";
import { sendCommitmentRecap } from "@/lib/services/verification";
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
      summary: "Market scan simulated because live telephony is not configured",
    });
    await autoBookIfSettled(operationId);
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
    // Through the real recap service, not around it: a simulated run should
    // exercise the delivery path rather than assert its outcome.
    await sendCommitmentRecap(call.id);
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

/**
 * The briefing changed after a carrier already agreed. Pact calls the same
 * carrier back, says so, and negotiates the new terms under the new mandate —
 * the standing agreement is retired first so nothing pretends to be live while
 * it is being replaced.
 */
/**
 * The market is worked end to end without a human pressing anything. Ranking was
 * always deterministic; only the trigger was manual. Once every quote call has
 * settled this books the standing winner — or, when the market produced nothing
 * the mandate allows, escalates rather than quietly stopping with an operation
 * that looks finished and has no carrier.
 */
export async function autoBookIfSettled(operationId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot(operationId);

  if (snapshot.commitment && !["SUPERSEDED", "REJECTED"].includes(snapshot.commitment.status)) return null;
  if (snapshot.calls.some((call) => call.mode === "BOOKING" && call.status !== "FAILED")) return null;

  const quotes = snapshot.calls.filter((call) => call.mode === "QUOTE");
  if (!quotes.length) return null;
  if (!quotes.every((call) => ["COMPLETED", "FAILED"].includes(call.status))) return null;

  if (!winner(snapshot)) {
    const blocked = latestOffers(snapshot.offers).filter((offer) => !offer.eligible);
    if (!blocked.length) return null;
    const call = quotes.at(-1)!;
    await store.createEscalation(
      operationId,
      call.id,
      "Every quote the market returned falls outside the mandate",
      blocked.map((offer) => `${offer.carrierId}: ${offer.violations.join(", ")}`).join(" · "),
    );
    return store.getSnapshot(operationId);
  }

  await store.addEvent({
    operationId,
    type: "market.settled",
    severity: "INFO",
    summary: "All quote calls settled; booking the standing winner without waiting for an operator",
  });
  return bookWinningOffer(operationId);
}

export async function startRenegotiation(operationId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot(operationId);
  const commitment = snapshot.commitment;
  if (!commitment || ["SUPERSEDED", "REJECTED"].includes(commitment.status)) {
    throw new Error("There is no standing agreement to renegotiate");
  }
  const carrier = snapshot.carriers.find((item) => item.id === commitment.carrierId);
  if (!carrier) throw new Error("Committed carrier not found");

  await store.supersedeCommitment(
    commitment.id,
    "Briefing changed after agreement; calling the carrier back to renegotiate under the new mandate",
  );
  const call = await store.createCall({ operationId, carrierId: carrier.id, mode: "RENEGOTIATION" });

  if (isVoiceConfigured() && process.env.VOLTA_DEMO_MODE !== "true") {
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
  } else {
    await store.updateCall(call.id, { status: "COMPLETED" });
    await store.addEvent({
      operationId,
      callId: call.id,
      type: "demo.renegotiation_simulated",
      severity: "WARNING",
      summary: "Renegotiation call simulated because live telephony is not configured",
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
        await referCallToOperator(call.openaiCallId, snapshot.operation.handoffPhoneE164);
        break;
      }
      default:
        await dialHumanTakeover(call, snapshot.operation.handoffPhoneE164);
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
