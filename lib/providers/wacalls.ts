import "server-only";

import type { CallAttempt, Carrier } from "@/lib/domain/types";

interface WaCallsSession {
  id: string;
  name: string;
  jid: string;
  state: string;
  paired: boolean;
}

export interface WaCallsSessionDetail {
  session: WaCallsSession;
  auth: { state: string; paired: boolean; qr?: string };
}

let resolvedSession: Promise<string> | null = null;

export function isWaCallsConfigured() {
  return Boolean(
    process.env.WACALLS_BASE_URL?.trim() && process.env.WACALLS_API_TOKEN?.trim(),
  );
}

function baseUrl() {
  const value = process.env.WACALLS_BASE_URL?.trim().replace(/\/$/, "");
  if (!value) throw new Error("WACALLS_BASE_URL is not configured");
  return value;
}

async function waFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = process.env.WACALLS_API_TOKEN?.trim();
  if (!token) throw new Error("WACALLS_API_TOKEN is not configured");
  const response = await fetch(`${baseUrl()}${path}`, {
    ...init,
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `WaCalls request failed (${response.status})`);
  return body;
}

export async function resolveWaCallsSession(): Promise<string> {
  const configured = process.env.WACALLS_SESSION_ID?.trim();
  if (configured) return configured;
  if (!resolvedSession) {
    resolvedSession = (async () => {
      const current = await waFetch<{ sessions: WaCallsSession[] }>("/api/sessions");
      if (current.sessions[0]) return current.sessions[0].id;
      const created = await waFetch<{ id: string }>("/api/sessions", {
        method: "POST",
        body: JSON.stringify({ name: "Volta Operations" }),
      });
      return created.id;
    })().catch((error) => {
      resolvedSession = null;
      throw error;
    });
  }
  return resolvedSession;
}

export async function getWaCallsStatus(): Promise<WaCallsSessionDetail> {
  const sessionId = await resolveWaCallsSession();
  return waFetch<WaCallsSessionDetail>(`/api/sessions/${encodeURIComponent(sessionId)}`);
}

export async function pairWaCallsSession(): Promise<WaCallsSessionDetail> {
  const sessionId = await resolveWaCallsSession();
  await waFetch<Record<string, never>>(`/api/sessions/${encodeURIComponent(sessionId)}/pair`, {
    method: "POST",
  });
  return getWaCallsStatus();
}

export async function dialWhatsAppCall(call: CallAttempt, carrier: Carrier) {
  const sessionId = await resolveWaCallsSession();
  const result = await waFetch<{
    call: { provider: "whatsapp"; callId: string; voltaCallId: string };
  }>(`/api/sessions/${encodeURIComponent(sessionId)}/agent-calls`, {
    method: "POST",
    body: JSON.stringify({ phone: carrier.phoneE164, volta_call_id: call.id }),
  });
  return { carrierCallSid: result.call.callId, agentCallSid: null };
}

export async function sendWhatsAppText(phone: string, text: string) {
  const sessionId = await resolveWaCallsSession();
  return waFetch<{ messageId: string }>(`/api/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({ phone, text }),
  });
}

export async function startWhatsAppBrowserTakeover(providerCallId: string, sdpOffer: string) {
  const sessionId = await resolveWaCallsSession();
  return waFetch<{ sdp_answer: string }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/calls/${encodeURIComponent(providerCallId)}/webrtc?takeover=true`,
    { method: "POST", body: JSON.stringify({ sdp_offer: sdpOffer }) },
  );
}

/**
 * WhatsApp has no transfer primitive, so the relay dials the third party and
 * crosses the audio of both legs once they answer. The counterparty never
 * leaves the line and the agent steps off it.
 */
export async function transferWhatsAppCall(providerCallId: string, phone: string) {
  const sessionId = await resolveWaCallsSession();
  return waFetch<{ transfer: { callId: string; dialedId: string; to: string; state: string } }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/calls/${encodeURIComponent(providerCallId)}/transfer`,
    { method: "POST", body: JSON.stringify({ phone }) },
  );
}
