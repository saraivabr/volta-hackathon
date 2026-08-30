import OpenAI from "openai";
import type {
  RealtimeResponseCreateMcpTool,
  RealtimeSessionCreateRequest,
} from "openai/resources/realtime/realtime";
import { getOpenAIKey, publicBaseUrl, requireOpenAIKey } from "@/lib/server/secrets";
import { buildCallPrompt } from "@/lib/voice/prompts";
import type { CallAttempt, Carrier, OperationSnapshot } from "@/lib/domain/types";

export const MCP_TOOLS = [
  "get_operation_context",
  "record_offer",
  "stage_booking",
  "confirm_booking",
  "report_operational_change",
  "request_handoff",
];

export function openAIClient(): OpenAI | null {
  const apiKey = getOpenAIKey();
  return apiKey ? new OpenAI({ apiKey }) : null;
}

function realtimeMcpTool(): RealtimeResponseCreateMcpTool {
  const authorization = process.env.VOLTA_MCP_SECRET;
  return {
    type: "mcp",
    server_label: "volta_operations",
    server_url: `${publicBaseUrl()}/api/mcp`,
    allowed_tools: MCP_TOOLS,
    require_approval: "never",
    ...(authorization ? { headers: { Authorization: `Bearer ${authorization}` } } : {}),
  };
}

export function buildRealtimeSession(
  snapshot: OperationSnapshot,
  call: CallAttempt,
  carrier?: Carrier,
  audioTransport: "telephony" | "whatsapp" = "telephony",
): RealtimeSessionCreateRequest {
  const audioFormat =
    audioTransport === "whatsapp"
      ? ({ type: "audio/pcm", rate: 24_000 } as const)
      : ({ type: "audio/pcmu" } as const);
  return {
    type: "realtime",
    model: process.env.OPENAI_REALTIME_MODEL?.trim() || "gpt-realtime-2.1",
    instructions: buildCallPrompt(snapshot, call, carrier),
    output_modalities: ["audio"],
    audio: {
      input: {
        format: audioFormat,
        noise_reduction: { type: "near_field" },
        transcription: {
          model: process.env.OPENAI_TRANSCRIBE_MODEL?.trim() || "gpt-4o-mini-transcribe",
          // Without this the transcriber guesses per utterance, and on short
          // noisy 16 kHz call audio it guesses badly — a live call came back
          // as Czech, Korean and Italian, so every answer read as ambiguous
          // and no booking could close. The mandate fixes the language of the
          // conversation, so fix the transcriber to it too.
          language: process.env.OPENAI_TRANSCRIBE_LANGUAGE?.trim() || "es",
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 600,
          create_response: true,
          interrupt_response: true,
          idle_timeout_ms: 5_000,
        },
      },
      output: {
        format: audioFormat,
        voice: "marin",
        speed: 1.05,
      },
    },
    tools: [realtimeMcpTool()],
    tool_choice: "auto",
    tracing: {
      workflow_name: "volta-operations-call",
      group_id: call.operationId,
      metadata: { callId: call.id, carrierId: call.carrierId, mode: call.mode },
    },
  };
}

export async function createRealtimeClientSecret(
  snapshot: OperationSnapshot,
  call: CallAttempt,
  carrier?: Carrier,
  audioTransport: "telephony" | "whatsapp" = "telephony",
) {
  const client = openAIClient();
  if (!client) throw new Error("OPENAI_API_KEY is not configured");
  return client.realtime.clientSecrets.create({
    expires_after: { anchor: "created_at", seconds: 60 },
    session: buildRealtimeSession(snapshot, call, carrier, audioTransport),
  });
}

export async function unwrapOpenAIWebhook(body: string, headers: Headers) {
  const client = new OpenAI({
    apiKey: requireOpenAIKey(),
    webhookSecret: process.env.OPENAI_WEBHOOK_SECRET,
  });
  return client.webhooks.unwrap(body, headers);
}

export async function acceptRealtimeCall(
  openaiCallId: string,
  snapshot: OperationSnapshot,
  call: CallAttempt,
  carrier?: Carrier,
) {
  const response = await fetch(`https://api.openai.com/v1/realtime/calls/${openaiCallId}/accept`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireOpenAIKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(buildRealtimeSession(snapshot, call, carrier)),
  });
  if (!response.ok) throw new Error(`OpenAI call acceptance failed (${response.status})`);
}
