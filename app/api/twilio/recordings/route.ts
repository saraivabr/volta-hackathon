import { after } from "next/server";
import { enqueueRecordingJob, processRecordingJob } from "@/lib/jobs/recordings";
import { verifiedTwilioForm } from "@/lib/server/twilio-form";

export async function POST(request: Request) {
  try {
    const form = await verifiedTwilioForm(request);
    const callId = new URL(request.url).searchParams.get("callId");
    if (!callId || !form.RecordingUrl) return new Response(null, { status: 400 });
    const jobId = await enqueueRecordingJob(callId, form.RecordingUrl);
    after(async () => {
      try {
        await processRecordingJob(jobId);
      } catch (error) {
        console.error(JSON.stringify({ level: "error", message: "Recording job failed", callId, error: String(error) }));
      }
    });
    return new Response(null, { status: 204 });
  } catch {
    return new Response("Forbidden", { status: 403 });
  }
}
