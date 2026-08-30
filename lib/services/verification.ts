import { toFile } from "openai/uploads";
import { getStore } from "@/lib/store";
import { openAIClient } from "@/lib/providers/openai-realtime";
import { isTwilioConfigured, twilioClient } from "@/lib/providers/twilio";
import { publicBaseUrl } from "@/lib/server/secrets";
import { sendWhatsAppText } from "@/lib/providers/wacalls";
import { sendTelnyxSms } from "@/lib/providers/telnyx";
import { isEmailConfigured, sendRecapEmail } from "@/lib/providers/email";
import { voiceTransport } from "@/lib/providers/voice";
import { isUnequivocalConfirmation } from "@/lib/domain/confirmation";
import { downloadRecording } from "@/lib/server/recording-storage";

/** Delivers the recap over every written channel that is configured. */
async function deliverTextRecap(phone: string, body: string) {
  // A simulated run must not message a real handset. The seed carries
  // placeholder numbers, and this used to be checked only on the Twilio branch.
  if (process.env.VOLTA_DEMO_MODE === "true") {
    return { channel: "simulated", reference: "SM_SIMULATED_NO_DELIVERY" };
  }
  switch (voiceTransport()) {
    case "whatsapp": {
      const { messageId } = await sendWhatsAppText(phone, body);
      return { channel: "WhatsApp", reference: `WA_${messageId}` };
    }
    case "telnyx": {
      const { messageId } = await sendTelnyxSms(phone, body);
      return { channel: "SMS", reference: `TX_${messageId}` };
    }
    default: {
      if (!isTwilioConfigured()) {
        return { channel: "simulated", reference: "SM_SIMULATED_NO_DELIVERY" };
      }
      const message = await twilioClient().messages.create({
        to: phone,
        from: process.env.TWILIO_PHONE_NUMBER!,
        body,
        statusCallback: `${publicBaseUrl()}/api/twilio/messages?commitmentId=${phone}`,
      });
      return { channel: "SMS", reference: `SM_${message.sid}` };
    }
  }
}

export async function sendCommitmentRecap(callId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot();
  const commitment = snapshot.commitment;
  if (!commitment || commitment.bookingCallId !== callId || commitment.status !== "VERBALLY_CONFIRMED") {
    return null;
  }
  const carrier = snapshot.carriers.find((item) => item.id === commitment.carrierId);
  if (!carrier) throw new Error("Commitment carrier not found");

  const body = `${commitment.recapText} Responde CORRECCIÓN si algún dato no coincide.`;
  const delivered: string[] = [];
  const failed: string[] = [];

  // Both channels are attempted. One landing is enough to hold the record, and
  // a channel that fails says so in the ledger instead of disappearing.
  try {
    const text = await deliverTextRecap(carrier.phoneE164, body);
    delivered.push(text.reference);
    await store.addEvent({
      operationId: commitment.operationId,
      callId,
      type: "recap.sent",
      severity: "SUCCESS",
      summary: `Written recap sent by ${text.channel}`,
      payload: { reference: text.reference },
    });
  } catch (error) {
    failed.push(`text: ${String(error)}`);
  }

  if (carrier.email && !isEmailConfigured()) {
    // A channel the operator asked for and the deployment cannot provide is a
    // gap worth naming, not one to skip quietly.
    await store.addEvent({
      operationId: commitment.operationId,
      callId,
      type: "recap.channel_unavailable",
      severity: "WARNING",
      summary: `${carrier.email} is on the briefing but no email sender is configured`,
    });
  }

  if (carrier.email && isEmailConfigured()) {
    try {
      const { messageId } = await sendRecapEmail(
        carrier.email,
        `${snapshot.operation.reference} · confirmación de recolección`,
        body,
      );
      delivered.push(`EM_${messageId}`);
      await store.addEvent({
        operationId: commitment.operationId,
        callId,
        type: "recap.sent",
        severity: "SUCCESS",
        summary: `Written recap emailed to ${carrier.email}`,
        payload: { reference: messageId },
      });
    } catch (error) {
      failed.push(`email: ${String(error)}`);
    }
  }

  if (!delivered.length) {
    await store.addEvent({
      operationId: commitment.operationId,
      callId,
      type: "recap.failed",
      severity: "DANGER",
      summary: "No written recap could be delivered; the commitment cannot advance",
      payload: { failed },
    });
    return null;
  }
  if (failed.length) {
    await store.addEvent({
      operationId: commitment.operationId,
      callId,
      type: "recap.partial",
      severity: "WARNING",
      summary: "One recap channel failed; another delivered",
      payload: { failed },
    });
  }
  return store.markRecapSent(commitment.id, delivered.join("+"));
}

interface DiarizedSegment {
  speaker?: string;
  text?: string;
  start?: number;
  end?: number;
}

export async function processRecording(callId: string, recordingUrl: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot();
  const commitment = snapshot.commitment;
  if (!commitment || commitment.bookingCallId !== callId) return;
  if (commitment.status === "PROPOSED") {
    await store.addEvent({
      operationId: commitment.operationId,
      callId,
      type: "evidence.skipped_unconfirmed",
      severity: "WARNING",
      summary: "Recording processed but the terms were never verbally confirmed; nothing to evidence",
    });
    return;
  }
  const client = openAIClient();
  if (!client) throw new Error("OpenAI client is not configured");

  let bytes: Buffer;
  let filename: string;
  if (recordingUrl.startsWith("supabase://")) {
    const stored = await downloadRecording(recordingUrl);
    bytes = stored.bytes;
    filename = `${callId}.wav`;
  } else if (voiceTransport() === "telnyx") {
    const mediaResponse = await fetch(recordingUrl, {
      headers: { Authorization: `Bearer ${process.env.TELNYX_API_KEY?.trim() ?? ""}` },
    });
    if (!mediaResponse.ok) throw new Error(`Recording download failed (${mediaResponse.status})`);
    bytes = Buffer.from(await mediaResponse.arrayBuffer());
    filename = `${callId}.wav`;
  } else {
    const auth = Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID ?? ""}:${process.env.TWILIO_AUTH_TOKEN ?? ""}`,
    ).toString("base64");
    const mediaResponse = await fetch(`${recordingUrl}.mp3`, {
      headers: isTwilioConfigured() ? { Authorization: `Basic ${auth}` } : {},
    });
    if (!mediaResponse.ok) throw new Error(`Recording download failed (${mediaResponse.status})`);
    bytes = Buffer.from(await mediaResponse.arrayBuffer());
    filename = `${callId}.mp3`;
  }
  const file = await toFile(bytes, filename);
  const transcript = await client.audio.transcriptions.create({
    file,
    model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe-diarize",
    response_format: "diarized_json",
    chunking_strategy: "auto",
  });
  const segments = ("segments" in transcript ? transcript.segments : []) as DiarizedSegment[];
  const evidence =
    [...segments]
      .reverse()
      .find((segment) => isUnequivocalConfirmation(segment.text ?? ""));
  if (!evidence || evidence.start === undefined || evidence.end === undefined) {
    await store.addEvent({
      operationId: commitment.operationId,
      callId,
      type: "evidence.verification_failed",
      severity: "DANGER",
      summary: "No unequivocal confirmation segment found in the recording",
    });
    return;
  }
  await store.linkEvidence(commitment.id, {
    callId,
    recordingUrl: `${publicBaseUrl()}/api/recordings/${callId}`,
    storagePath: recordingUrl,
    speaker: evidence.speaker ?? "unknown",
    segmentText: evidence.text ?? "",
    startSeconds: Math.max(0, evidence.start - 1),
    endSeconds: evidence.end,
  });
}
