import { after } from "next/server";
import { z } from "zod";
import { enqueueRecordingJob, processRecordingJob } from "@/lib/jobs/recordings";
import { authorizeRelayRequest } from "@/lib/server/relay-auth";
import { uploadRecording } from "@/lib/server/recording-storage";

export const runtime = "nodejs";

const callIdSchema = z.string().uuid();

export async function POST(request: Request) {
  try {
    if (!authorizeRelayRequest(request)) return new Response("Unauthorized", { status: 401 });
    const callId = callIdSchema.parse(new URL(request.url).searchParams.get("callId"));
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > 30 * 1024 * 1024) return new Response("Recording too large", { status: 413 });
    const body = await request.arrayBuffer();
    if (body.byteLength < 44 || body.byteLength > 30 * 1024 * 1024) {
      return new Response("Invalid recording", { status: 400 });
    }
    const path = `${callId}/${crypto.randomUUID()}.wav`;
    const source = await uploadRecording(path, body, "audio/wav");
    const jobId = await enqueueRecordingJob(callId, source);
    after(async () => {
      try {
        await processRecordingJob(jobId);
      } catch (error) {
        console.error(JSON.stringify({ level: "error", message: "WhatsApp recording job failed", callId, error: String(error) }));
      }
    });
    return Response.json({ ok: true, source }, { status: 202 });
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "WhatsApp recording rejected", error: String(error) }));
    return new Response("Invalid recording", { status: 400 });
  }
}
