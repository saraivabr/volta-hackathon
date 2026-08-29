import type { CallAttempt, Carrier } from "@/lib/domain/types";
import { dialCall as dialTwilioCall, isTwilioConfigured } from "./twilio";
import { dialWhatsAppCall, isWaCallsConfigured } from "./wacalls";

export type VoiceTransport = "twilio" | "whatsapp";

export function voiceTransport(): VoiceTransport {
  return process.env.VOLTA_VOICE_TRANSPORT?.trim() === "whatsapp" ? "whatsapp" : "twilio";
}

export function isVoiceConfigured() {
  return voiceTransport() === "whatsapp" ? isWaCallsConfigured() : isTwilioConfigured();
}

export async function dialVoiceCall(call: CallAttempt, carrier: Carrier) {
  return voiceTransport() === "whatsapp"
    ? dialWhatsAppCall(call, carrier)
    : dialTwilioCall(call, carrier);
}
