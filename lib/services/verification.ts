import { toFile } from "openai/uploads";
import { getStore } from "@/lib/store";
import { openAIClient } from "@/lib/providers/openai-realtime";
import { isTwilioConfigured, twilioClient } from "@/lib/providers/twilio";
import { publicBaseUrl } from "@/lib/server/secrets";
import { sendWhatsAppText } from "@/lib/providers/wacalls";
import { voiceTransport } from "@/lib/providers/voice";
import { isUnequivocalConfirmation } from "@/lib/domain/confirmation";
import { downloadRecording } from "@/lib/server/recording-storage";

export async function sendCommitmentRecap(callId: string) {
  const store = getStore();
  const snapshot = await store.getSnapshot();
  const commitment = snapshot.commitment;
  if (!commitment || commitment.bookingCallId !== callId || commitment.status !== "VERBALLY_CONFIRMED") {
    return null;
  }
  const carrier = snapshot.carriers.find((item) => item.id === commitment.carrierId);
  if (!carrier) throw new Error("Commitment carrier not found");

  if (voiceTransport() === "whatsapp") {
    const message = await sendWhatsAppText(
      carrier.phoneE164,
      `${commitment.recapText} Responde CORRECCIÓN si algún dato no coincide.`,
    );
    await store.markRecapSent(commitment.id, `WA_${message.messageId}`);
    await store.addEvent({
      operationId: commitment.operationId,
      callId,
      type: "recap.sent",
      severity: "SUCCESS",
      summary: "Written recap sent by WhatsApp",
      payload: { messageId: message.messageId },
    });
    return commitment;
  }

  if (!isTwilioConfigured() || process.env.VOLTA_DEMO_MODE === "true") {
    return store.markRecapSent(commitment.id, "SM_DEMO_VERIFIED");
  }
  const message = await twilioClient().messages.create({
    to: carrier.phoneE164,
    from: process.env.TWILIO_PHONE_NUMBER!,
    body: `${commitment.recapText} Responde CORRECCIÓN si algún dato no coincide.`,
    statusCallback: `${publicBaseUrl()}/api/twilio/messages?commitmentId=${commitment.id}`,
  });
  await store.addEvent({
    operationId: commitment.operationId,
    callId,
    type: "recap.queued",
    summary: "Written recap queued with Twilio",
    payload: { messageSid: message.sid },
  });
  return commitment;
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
  const client = openAIClient();
  if (!client) throw new Error("OpenAI client is not configured");

  let bytes: Buffer;
  let filename: string;
  if (recordingUrl.startsWith("supabase://")) {
    const stored = await downloadRecording(recordingUrl);
    bytes = stored.bytes;
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
