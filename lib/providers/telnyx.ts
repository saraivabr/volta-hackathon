import "server-only";

import { createPublicKey, verify } from "node:crypto";
import type { CallAttempt, Carrier } from "@/lib/domain/types";
import { publicBaseUrl, requireOpenAIKey } from "@/lib/server/secrets";

const TELNYX_API = "https://api.telnyx.com/v2";
const OPENAI_SIP_HOST = "sip.api.openai.com";
const SIGNATURE_TOLERANCE_SECONDS = 300;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export function isTelnyxConfigured() {
  return Boolean(
    process.env.TELNYX_API_KEY?.trim() &&
      process.env.TELNYX_PHONE_NUMBER?.trim() &&
      process.env.TELNYX_TEXML_ACCOUNT_SID?.trim() &&
      process.env.TELNYX_TEXML_APP_ID?.trim() &&
      process.env.OPENAI_PROJECT_ID?.trim(),
  );
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

/**
 * OpenAI accepts the media leg over SIP. The X-Volta-* headers travel with the
 * INVITE so the realtime.call.incoming webhook can correlate the call without
 * trusting anything the counterparty says.
 */
export function openAiSipUri(call: CallAttempt): string {
  const headers = new URLSearchParams({
    "X-Volta-Call-Id": call.id,
    "X-Volta-Operation-Id": call.operationId,
    "X-Volta-Mode": call.mode,
  });
  return `sip:${required("OPENAI_PROJECT_ID")}@${OPENAI_SIP_HOST};transport=tls?${headers}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Bridges the PSTN leg straight into the OpenAI realtime session. */
export function dialSipTexml(call: CallAttempt): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    '<Dial answerOnBridge="true" timeLimit="900">',
    `<Sip>${escapeXml(openAiSipUri(call))}</Sip>`,
    "</Dial>",
    "</Response>",
  ].join("");
}

export function hangupTexml(reason: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<Response>",
    `<!-- ${escapeXml(reason)} -->`,
    "<Hangup/>",
    "</Response>",
  ].join("");
}

function voiceUrl(call: CallAttempt) {
  return `${publicBaseUrl()}/api/telnyx/texml/voice?callId=${encodeURIComponent(call.id)}`;
}

function statusUrl(call: CallAttempt) {
  return `${publicBaseUrl()}/api/telnyx/texml/status?callId=${encodeURIComponent(call.id)}`;
}

async function texmlRequest(path: string, body: URLSearchParams) {
  const response = await fetch(
    `${TELNYX_API}/texml/Accounts/${required("TELNYX_TEXML_ACCOUNT_SID")}${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${required("TELNYX_API_KEY")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const detail =
      (payload.errors as Array<{ detail?: string }> | undefined)?.[0]?.detail ??
      `Telnyx request failed (${response.status})`;
    throw new Error(detail);
  }
  return payload;
}

function callSid(payload: Record<string, unknown>): string {
  const sid = payload.sid ?? payload.call_sid ?? payload.CallSid;
  if (typeof sid !== "string" || !sid) throw new Error("Telnyx did not return a call sid");
  return sid;
}

export async function dialCall(call: CallAttempt, carrier: Carrier) {
  const body = new URLSearchParams({
    To: carrier.phoneE164,
    From: required("TELNYX_PHONE_NUMBER"),
    ApplicationSid: required("TELNYX_TEXML_APP_ID"),
    Url: voiceUrl(call),
    Method: "POST",
    StatusCallback: statusUrl(call),
    StatusCallbackMethod: "POST",
    Record: "true",
    RecordingChannels: "dual",
    RecordingStatusCallback: `${publicBaseUrl()}/api/telnyx/recordings?callId=${encodeURIComponent(call.id)}`,
    RecordingStatusCallbackMethod: "POST",
    Timeout: "30",
  });
  for (const event of ["initiated", "ringing", "answered", "completed"]) {
    body.append("StatusCallbackEvent", event);
  }
  const payload = await texmlRequest("/Calls", body);
  return { carrierCallSid: callSid(payload), agentCallSid: null };
}

export async function sendTelnyxSms(to: string, text: string) {
  const response = await fetch(`${TELNYX_API}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${required("TELNYX_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: required("TELNYX_PHONE_NUMBER"), to, text }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    data?: { id?: string };
    errors?: Array<{ detail?: string }>;
  };
  if (!response.ok || !payload.data?.id) {
    throw new Error(payload.errors?.[0]?.detail ?? `Telnyx SMS failed (${response.status})`);
  }
  return { messageId: payload.data.id };
}

/**
 * Escalation path. OpenAI transfers the live leg to a SIP URI on our trunk, so
 * the counterparty never gets hung up on. REFER to a tel: URI is unsupported,
 * which is why the operator is addressed through the Telnyx SIP domain.
 */
export async function referCallToOperator(openaiCallId: string) {
  const operator = required("OPERATOR_PHONE_E164").replace(/^\+/, "");
  const domain = required("TELNYX_SIP_DOMAIN");
  const response = await fetch(
    `https://api.openai.com/v1/realtime/calls/${encodeURIComponent(openaiCallId)}/refer`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${requireOpenAIKey()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ target_uri: `sip:${operator}@${domain}` }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) {
    throw new Error(`OpenAI REFER failed (${response.status})`);
  }
}

export function verifyTelnyxSignature(rawBody: string, headers: Headers): boolean {
  const encodedKey = process.env.TELNYX_PUBLIC_KEY?.trim();
  const signature = headers.get("telnyx-signature-ed25519");
  const timestamp = headers.get("telnyx-timestamp");
  if (!encodedKey || !signature || !timestamp) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > SIGNATURE_TOLERANCE_SECONDS) return false;

  try {
    const publicKey = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(encodedKey, "base64")]),
      format: "der",
      type: "spki",
    });
    return verify(
      null,
      Buffer.from(`${timestamp}|${rawBody}`),
      publicKey,
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

function unsignedWebhooksAllowed() {
  return process.env.VOLTA_DEMO_MODE === "true" && process.env.NODE_ENV !== "production";
}

export async function verifiedTelnyxForm(request: Request): Promise<Record<string, string>> {
  const raw = await request.text();
  if (!verifyTelnyxSignature(raw, request.headers) && !unsignedWebhooksAllowed()) {
    throw new Error("Invalid Telnyx signature");
  }
  return Object.fromEntries(new URLSearchParams(raw));
}
