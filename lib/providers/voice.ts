import type { CallAttempt, Carrier } from "@/lib/domain/types";
import { dialCall as dialTwilioCall, isTwilioConfigured } from "./twilio";
import { dialCall as dialTelnyxCall, isTelnyxConfigured } from "./telnyx";
import { dialWhatsAppCall, isWaCallsConfigured } from "./wacalls";
import { voiceProviderTag, voiceTransport } from "./transport";

export { voiceProviderTag, voiceTransport };
export type { VoiceProviderTag, VoiceTransport } from "./transport";

export function isVoiceConfigured() {
  switch (voiceTransport()) {
    case "whatsapp":
      return isWaCallsConfigured();
    case "telnyx":
      return isTelnyxConfigured();
    default:
      return isTwilioConfigured();
  }
}

export async function dialVoiceCall(call: CallAttempt, carrier: Carrier) {
  switch (voiceTransport()) {
    case "whatsapp":
      return dialWhatsAppCall(call, carrier);
    case "telnyx":
      return dialTelnyxCall(call, carrier);
    default:
      return dialTwilioCall(call, carrier);
  }
}
