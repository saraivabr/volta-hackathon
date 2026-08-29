import { processPendingRecordingJobs } from "@/lib/jobs/recordings";

export async function GET(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (expected && request.headers.get("authorization") !== `Bearer ${expected}`) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const processed = await processPendingRecordingJobs();
  return Response.json({ ok: true, processed });
}

