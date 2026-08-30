import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import type { CallAttempt } from "@/lib/domain/types";
import {
  dialSipTexml,
  isTelnyxConfigured,
  openAiSipUri,
  verifyTelnyxSignature,
} from "@/lib/providers/telnyx";
import { voiceProviderTag, voiceTransport } from "@/lib/providers/transport";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

const call: CallAttempt = {
  id: "call-1",
  operationId: "op-2041",
  carrierId: "carrier-azul",
  mode: "QUOTE",
  status: "QUEUED",
  conferenceName: "volta-op-2041-abc",
  twilioCallSid: null,
  twilioAgentCallSid: null,
  openaiCallId: null,
  startedAt: null,
  endedAt: null,
  failureReason: null,
};

/** Builds an Ed25519 keypair and signs the payload the way Telnyx does. */
function signedWebhook(body: string, timestamp: string) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = publicKey.export({ format: "der", type: "spki" }) as Buffer;
  const signature = sign(null, Buffer.from(`${timestamp}|${body}`), privateKey);
  return {
    publicKeyBase64: raw.subarray(raw.length - 32).toString("base64"),
    headers: new Headers({
      "telnyx-signature-ed25519": signature.toString("base64"),
      "telnyx-timestamp": timestamp,
    }),
  };
}

describe("voice transport resolution", () => {
  it("defaults to twilio when nothing is configured", () => {
    delete process.env.VOLTA_VOICE_TRANSPORT;
    expect(voiceTransport()).toBe("twilio");
    expect(voiceProviderTag()).toBe("TWILIO");
  });

  it("resolves telnyx and whatsapp from the environment", () => {
    process.env.VOLTA_VOICE_TRANSPORT = "telnyx";
    expect(voiceProviderTag()).toBe("TELNYX");
    process.env.VOLTA_VOICE_TRANSPORT = "whatsapp";
    expect(voiceProviderTag()).toBe("WHATSAPP");
  });

  it("falls back to twilio for an unknown transport", () => {
    process.env.VOLTA_VOICE_TRANSPORT = "carrier-pigeon";
    expect(voiceTransport()).toBe("twilio");
  });
});

describe("telnyx configuration", () => {
  it("requires every field before dialling is considered available", () => {
    process.env.TELNYX_API_KEY = "key";
    process.env.TELNYX_PHONE_NUMBER = "+19142209674";
    process.env.TELNYX_TEXML_ACCOUNT_SID = "account";
    process.env.OPENAI_PROJECT_ID = "proj_1";
    delete process.env.TELNYX_TEXML_APP_ID;
    expect(isTelnyxConfigured()).toBe(false);
    process.env.TELNYX_TEXML_APP_ID = "app";
    expect(isTelnyxConfigured()).toBe(true);
  });
});

describe("openai sip target", () => {
  it("carries the correlation headers Volta needs to bind the call", () => {
    process.env.OPENAI_PROJECT_ID = "proj_1";
    const uri = openAiSipUri(call);
    expect(uri).toContain("sip:proj_1@sip.api.openai.com;transport=tls");
    expect(uri).toContain("X-Volta-Call-Id=call-1");
    expect(uri).toContain("X-Volta-Operation-Id=op-2041");
    expect(uri).toContain("X-Volta-Mode=QUOTE");
  });

  it("escapes the header separator so the TeXML stays well formed", () => {
    process.env.OPENAI_PROJECT_ID = "proj_1";
    const texml = dialSipTexml(call);
    expect(openAiSipUri(call)).toContain("&");
    expect(texml).toContain("&amp;");
    expect(texml).not.toMatch(/&(?!amp;|lt;|gt;|quot;)/);
  });
});

describe("telnyx webhook signature", () => {
  const body = "CallSid=abc&CallStatus=completed";

  it("accepts a signature produced by the configured public key", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const { publicKeyBase64, headers } = signedWebhook(body, timestamp);
    process.env.TELNYX_PUBLIC_KEY = publicKeyBase64;
    expect(verifyTelnyxSignature(body, headers)).toBe(true);
  });

  it("rejects a tampered body", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const { publicKeyBase64, headers } = signedWebhook(body, timestamp);
    process.env.TELNYX_PUBLIC_KEY = publicKeyBase64;
    expect(verifyTelnyxSignature("CallSid=abc&CallStatus=failed", headers)).toBe(false);
  });

  it("rejects a replayed timestamp outside the tolerance window", () => {
    const stale = String(Math.floor(Date.now() / 1000) - 3600);
    const { publicKeyBase64, headers } = signedWebhook(body, stale);
    process.env.TELNYX_PUBLIC_KEY = publicKeyBase64;
    expect(verifyTelnyxSignature(body, headers)).toBe(false);
  });

  it("rejects everything when no public key is configured", () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const { headers } = signedWebhook(body, timestamp);
    delete process.env.TELNYX_PUBLIC_KEY;
    expect(verifyTelnyxSignature(body, headers)).toBe(false);
  });
});
