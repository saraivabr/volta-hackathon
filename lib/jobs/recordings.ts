import "server-only";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { processRecording } from "@/lib/services/verification";

interface RecordingJob {
  id: string;
  callId: string;
  recordingUrl: string;
  status: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  attempts: number;
  availableAt: string;
  lastError: string | null;
}

declare global {
  var __voltaRecordingJobs: RecordingJob[] | undefined;
}

const memoryJobs = (globalThis.__voltaRecordingJobs ??= []);

function database() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key
    ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
    : null;
}

export async function enqueueRecordingJob(callId: string, recordingUrl: string): Promise<string> {
  const db = database();
  if (db) {
    const { data, error } = await db
      .from("volta_jobs")
      .upsert(
        {
          kind: "PROCESS_RECORDING",
          dedupe_key: `recording:${callId}`,
          payload: { callId, recordingUrl },
          status: "PENDING",
          available_at: new Date().toISOString(),
        },
        { onConflict: "dedupe_key" },
      )
      .select("id")
      .single();
    if (error) throw new Error(`Job enqueue failed: ${error.message}`);
    return data.id as string;
  }
  const existing = memoryJobs.find((job) => job.callId === callId);
  if (existing) return existing.id;
  const job: RecordingJob = {
    id: randomUUID(),
    callId,
    recordingUrl,
    status: "PENDING",
    attempts: 0,
    availableAt: new Date().toISOString(),
    lastError: null,
  };
  memoryJobs.push(job);
  return job.id;
}

export async function processRecordingJob(id: string): Promise<void> {
  const db = database();
  if (db) {
    const { data, error } = await db.from("volta_jobs").select("*").eq("id", id).single();
    if (error || !data) throw new Error(error?.message ?? "Job not found");
    if (data.status === "DONE") return;
    await db.from("volta_jobs").update({ status: "PROCESSING", attempts: data.attempts + 1 }).eq("id", id);
    try {
      const payload = data.payload as { callId: string; recordingUrl: string };
      await processRecording(payload.callId, payload.recordingUrl);
      await db.from("volta_jobs").update({ status: "DONE", completed_at: new Date().toISOString() }).eq("id", id);
    } catch (errorValue) {
      const attempts = Number(data.attempts) + 1;
      await db
        .from("volta_jobs")
        .update({
          status: attempts >= 4 ? "FAILED" : "PENDING",
          last_error: String(errorValue),
          available_at: new Date(Date.now() + 2 ** attempts * 30_000).toISOString(),
        })
        .eq("id", id);
      throw errorValue;
    }
    return;
  }

  const job = memoryJobs.find((item) => item.id === id);
  if (!job || job.status === "DONE") return;
  job.status = "PROCESSING";
  job.attempts += 1;
  try {
    await processRecording(job.callId, job.recordingUrl);
    job.status = "DONE";
  } catch (error) {
    job.lastError = String(error);
    job.status = job.attempts >= 4 ? "FAILED" : "PENDING";
    job.availableAt = new Date(Date.now() + 2 ** job.attempts * 30_000).toISOString();
    throw error;
  }
}

export async function processPendingRecordingJobs(): Promise<number> {
  const db = database();
  if (db) {
    const { data, error } = await db
      .from("volta_jobs")
      .select("id")
      .eq("kind", "PROCESS_RECORDING")
      .eq("status", "PENDING")
      .lte("available_at", new Date().toISOString())
      .limit(5);
    if (error) throw new Error(`Job lookup failed: ${error.message}`);
    await Promise.allSettled((data ?? []).map((job) => processRecordingJob(job.id as string)));
    return data?.length ?? 0;
  }
  const pending = memoryJobs.filter(
    (job) => job.status === "PENDING" && new Date(job.availableAt).getTime() <= Date.now(),
  );
  await Promise.allSettled(pending.map((job) => processRecordingJob(job.id)));
  return pending.length;
}

