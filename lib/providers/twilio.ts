import twilio, { type Twilio } from "twilio";
import type { CallAttempt, Carrier } from "@/lib/domain/types";
import { createStreamAuthorization } from "@/lib/server/relay-auth";
import { publicBaseUrl } from "@/lib/server/secrets";

export function isTwilioConfigured() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
      process.env.TWILIO_AUTH_TOKEN &&
      process.env.TWILIO_PHONE_NUMBER &&
      process.env.OPENAI_PROJECT_ID,
  );
}

export function twilioClient(): Twilio {
  if (!isTwilioConfigured()) throw new Error("Twilio is not configured");
  return twilio(process.env.TWILIO_ACCOUNT_SID!.trim(), process.env.TWILIO_AUTH_TOKEN!.trim());
}

function joinUrl(call: CallAttempt, role: string) {
  const query = new URLSearchParams({ callId: call.id, role });
  return `${publicBaseUrl()}/api/twilio/voice/join?${query}`;
}

function statusUrl(call: CallAttempt, role: string) {
  const query = new URLSearchParams({ callId: call.id, role });
  return `${publicBaseUrl()}/api/twilio/voice/status?${query}`;
}

export async function dialCall(call: CallAttempt, carrier: Carrier) {
  if (process.env.VOLTA_REALTIME_TRANSPORT?.trim() === "media-stream") {
    const carrierLeg = await dialStreamingCall(call, carrier);
    return { carrierCallSid: carrierLeg.sid, agentCallSid: null };
  }
  const client = twilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER!.trim();
  const sipHeaders = new URLSearchParams({
    "X-Volta-Call-Id": call.id,
    "X-Volta-Operation-Id": call.operationId,
    "X-Volta-Mode": call.mode,
  });
  const sipTarget = `sip:${process.env.OPENAI_PROJECT_ID!.trim()}@sip.api.openai.com;transport=tls?${sipHeaders}`;

  const [carrierLeg, agentLeg] = await Promise.all([
    client.calls.create({
      to: carrier.phoneE164,
      from,
      url: joinUrl(call, "carrier"),
      statusCallback: statusUrl(call, "carrier"),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    }),
    client.calls.create({
      to: sipTarget,
      from,
      url: joinUrl(call, "agent"),
      statusCallback: statusUrl(call, "agent"),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    }),
  ]);
  return { carrierCallSid: carrierLeg.sid, agentCallSid: agentLeg.sid };
}

export async function dialStreamingCall(call: CallAttempt, carrier: Carrier) {
  const client = twilioClient();
  const query = new URLSearchParams({ callId: call.id });
  return client.calls.create({
    to: carrier.phoneE164,
    from: process.env.TWILIO_PHONE_NUMBER!.trim(),
    url: `${publicBaseUrl()}/api/twilio/voice/stream?${query}`,
    statusCallback: statusUrl(call, "carrier"),
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
    record: true,
    recordingTrack: "both",
    recordingChannels: "mono",
    recordingStatusCallback: `${publicBaseUrl()}/api/twilio/recordings?callId=${call.id}`,
    recordingStatusCallbackEvent: ["completed", "absent"],
    trim: "do-not-trim",
    timeout: 30,
    timeLimit: 180,
  });
}

export async function dialAgentLeg(call: CallAttempt) {
  const client = twilioClient();
  const from = process.env.TWILIO_PHONE_NUMBER!.trim();
  const sipHeaders = new URLSearchParams({
    "X-Volta-Call-Id": call.id,
    "X-Volta-Operation-Id": call.operationId,
    "X-Volta-Mode": call.mode,
  });
  return client.calls.create({
    to: `sip:${process.env.OPENAI_PROJECT_ID!.trim()}@sip.api.openai.com;transport=tls?${sipHeaders}`,
    from,
    url: joinUrl(call, "agent"),
    statusCallback: statusUrl(call, "agent"),
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });
}

export async function dialHumanTakeover(call: CallAttempt) {
  const phone = process.env.OPERATOR_PHONE_E164;
  if (!phone) throw new Error("OPERATOR_PHONE_E164 is not configured");
  return twilioClient().calls.create({
    to: phone.trim(),
    from: process.env.TWILIO_PHONE_NUMBER!.trim(),
    url: joinUrl(call, "human"),
    statusCallback: statusUrl(call, "human"),
    statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
  });
}

export function validateTwilioWebhook(request: Request, params: Record<string, string>): boolean {
  if (process.env.VOLTA_DEMO_MODE === "true" && process.env.NODE_ENV !== "production") return true;
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token || !signature) return false;
  const incoming = new URL(request.url);
  const canonical = `${publicBaseUrl()}${incoming.pathname}${incoming.search}`;
  return twilio.validateRequest(token.trim(), signature, canonical, params);
}

export function conferenceTwiml(call: CallAttempt, role: string): string {
  const response = new twilio.twiml.VoiceResponse();
  const dial = response.dial();
  dial.conference(
    {
      startConferenceOnEnter: true,
      endConferenceOnExit: false,
      beep: role === "human" ? "onEnter" : "false",
      record: "record-from-start",
      recordingStatusCallback: `${publicBaseUrl()}/api/twilio/recordings?callId=${call.id}`,
      statusCallback: `${publicBaseUrl()}/api/twilio/conference?callId=${call.id}&role=${role}`,
      statusCallbackEvent: ["start", "end", "join", "leave"],
    },
    call.conferenceName,
  );
  return response.toString();
}

export function streamingTwiml(call: CallAttempt): string {
  const relayUrl = process.env.REALTIME_RELAY_URL?.trim();
  if (!relayUrl?.startsWith("wss://")) throw new Error("REALTIME_RELAY_URL is not configured");
  const response = new twilio.twiml.VoiceResponse();
  const connect = response.connect();
  const stream = connect.stream({ url: relayUrl });
  stream.parameter({ name: "callId", value: call.id });
  stream.parameter({ name: "streamAuth", value: createStreamAuthorization(call.id) });
  response.hangup();
  return response.toString();
}
