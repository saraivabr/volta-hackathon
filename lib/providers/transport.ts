export type VoiceTransport = "twilio" | "whatsapp" | "telnyx";
export type VoiceProviderTag = "TWILIO" | "WHATSAPP" | "TELNYX";

const tags: Record<VoiceTransport, VoiceProviderTag> = {
  twilio: "TWILIO",
  whatsapp: "WHATSAPP",
  telnyx: "TELNYX",
};

export function voiceTransport(): VoiceTransport {
  const value = process.env.VOLTA_VOICE_TRANSPORT?.trim();
  if (value === "whatsapp" || value === "telnyx") return value;
  return "twilio";
}

export function voiceProviderTag(): VoiceProviderTag {
  return tags[voiceTransport()];
}
