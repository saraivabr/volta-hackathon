import { afterEach, describe, expect, it } from "vitest";
import twilio from "twilio";
import { validateTwilioWebhook } from "@/lib/providers/twilio";

describe("Twilio webhook signature", () => {
  afterEach(() => {
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.APP_BASE_URL;
  });

  it("accepts the canonical public URL and rejects a forged signature", () => {
    process.env.TWILIO_AUTH_TOKEN = "test-auth-token";
    process.env.APP_BASE_URL = "https://volta.example";
    const params = { CallSid: "CA123", CallStatus: "completed" };
    const url = "https://volta.example/api/twilio/voice/status?callId=call-1&role=carrier";
    const signature = twilio.getExpectedTwilioSignature("test-auth-token", url, params);
    const request = new Request(url, { headers: { "x-twilio-signature": signature } });
    expect(validateTwilioWebhook(request, params)).toBe(true);
    const forged = new Request(url, { headers: { "x-twilio-signature": "forged" } });
    expect(validateTwilioWebhook(forged, params)).toBe(false);
  });
});

