type TwilioStart = {
  event: "start";
  streamSid: string;
  start: {
    streamSid: string;
    callSid: string;
    customParameters: { callId?: string; streamAuth?: string };
  };
};

type TwilioMedia = {
  event: "media";
  streamSid: string;
  media: { payload: string };
};

type TwilioStop = { event: "stop"; streamSid: string };
type TwilioMessage = TwilioStart | TwilioMedia | TwilioStop | { event: "other" };

type RealtimeToken = {
  value: string;
  expiresAt: number;
  projectId: string | null;
};

type OpenAIEvent = {
  type: string;
  delta?: string;
  session?: { id?: string };
  error?: { message?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseJson(data: unknown): unknown {
  if (typeof data !== "string") return null;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return null;
  }
}

function parseTwilioMessage(data: unknown): TwilioMessage | null {
  const value = parseJson(data);
  if (!isRecord(value) || typeof value.event !== "string") return null;
  if (value.event === "start" && isRecord(value.start)) {
    const start = value.start;
    if (
      typeof start.streamSid === "string" &&
      typeof start.callSid === "string" &&
      isRecord(start.customParameters)
    ) {
      return {
        event: "start",
        streamSid: typeof value.streamSid === "string" ? value.streamSid : start.streamSid,
        start: {
          streamSid: start.streamSid,
          callSid: start.callSid,
          customParameters: {
            callId: typeof start.customParameters.callId === "string" ? start.customParameters.callId : undefined,
            streamAuth:
              typeof start.customParameters.streamAuth === "string" ? start.customParameters.streamAuth : undefined,
          },
        },
      };
    }
  }
  if (
    value.event === "media" &&
    typeof value.streamSid === "string" &&
    isRecord(value.media) &&
    typeof value.media.payload === "string"
  ) {
    return { event: "media", streamSid: value.streamSid, media: { payload: value.media.payload } };
  }
  if (value.event === "stop" && typeof value.streamSid === "string") {
    return { event: "stop", streamSid: value.streamSid };
  }
  return { event: "other" };
}

function parseOpenAIEvent(data: unknown): OpenAIEvent | null {
  const value = parseJson(data);
  if (!isRecord(value) || typeof value.type !== "string") return null;
  const event: OpenAIEvent = { type: value.type };
  if (typeof value.delta === "string") event.delta = value.delta;
  if (isRecord(value.session) && typeof value.session.id === "string") event.session = { id: value.session.id };
  if (isRecord(value.error) && typeof value.error.message === "string") event.error = { message: value.error.message };
  return event;
}

function encodeBase64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function twilioSignatureValid(request: Request, authToken: string): Promise<boolean> {
  const provided = request.headers.get("x-twilio-signature");
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const candidates = request.url.endsWith("/") ? [request.url] : [request.url, `${request.url}/`];
  for (const url of candidates) {
    const expected = encodeBase64(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(url)));
    const left = new TextEncoder().encode(expected);
    const right = new TextEncoder().encode(provided);
    if (left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right)) return true;
  }
  return false;
}

async function streamAuthorizationValid(callId: string, provided: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(callId)));
  const expected = encodeBase64(digest.buffer).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const left = new TextEncoder().encode(expected);
  const right = new TextEncoder().encode(provided);
  return left.byteLength === right.byteLength && crypto.subtle.timingSafeEqual(left, right);
}

async function fetchRealtimeToken(env: Env, callId: string): Promise<RealtimeToken> {
  const response = await fetch(env.VOLTA_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RELAY_SHARED_SECRET}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ callId }),
  });
  if (!response.ok) throw new Error(`Token endpoint returned ${response.status}`);
  const value = (await response.json()) as unknown;
  if (!isRecord(value) || typeof value.value !== "string" || typeof value.expiresAt !== "number") {
    throw new Error("Token endpoint returned an invalid payload");
  }
  return {
    value: value.value,
    expiresAt: value.expiresAt,
    projectId: typeof value.projectId === "string" ? value.projectId : null,
  };
}

function reportEvent(
  ctx: ExecutionContext,
  env: Env,
  callId: string,
  eventType: "stream.started" | "session.created" | "response.done" | "stream.stopped" | "relay.error",
  extra: { sessionId?: string; detail?: string } = {},
) {
  ctx.waitUntil(
    fetch(env.VOLTA_EVENT_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RELAY_SHARED_SECRET}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ callId, eventType, ...extra }),
    }).then((response) => {
      if (!response.ok) {
        console.error(JSON.stringify({ level: "error", event: "relay.report.failed", callId, status: response.status }));
      }
    }),
  );
}

function closeSocket(socket: WebSocket, code: number, reason: string) {
  if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
    socket.close(code, reason.slice(0, 123));
  }
}

async function handleTwilioStream(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!(await twilioSignatureValid(request, env.TWILIO_AUTH_TOKEN))) {
    return new Response("Invalid Twilio signature", { status: 403 });
  }

  const pair = new WebSocketPair();
  const [client, twilioSocket] = Object.values(pair);
  twilioSocket.accept();

  let openaiSocket: WebSocket | null = null;
  let streamSid: string | null = null;
  let callId: string | null = null;
  const pendingAudio: string[] = [];

  const fail = (message: string) => {
    console.error(JSON.stringify({ level: "error", event: "relay.error", callId, message }));
    if (callId) reportEvent(ctx, env, callId, "relay.error", { detail: message });
    if (openaiSocket) closeSocket(openaiSocket, 1011, "Relay failed");
    closeSocket(twilioSocket, 1011, "Relay failed");
  };

  twilioSocket.addEventListener("message", (message) => {
    const event = parseTwilioMessage(message.data);
    if (!event) return;

    if (event.event === "start") {
      streamSid = event.start.streamSid;
      callId = event.start.customParameters.callId ?? null;
      const streamAuth = event.start.customParameters.streamAuth ?? "";
      if (!callId) {
        fail("Missing Volta call id");
        return;
      }
      ctx.waitUntil(
        (async () => {
          if (!(await streamAuthorizationValid(callId!, streamAuth, env.RELAY_SHARED_SECRET))) {
            throw new Error("Invalid stream authorization");
          }
          reportEvent(ctx, env, callId!, "stream.started");
          const token = await fetchRealtimeToken(env, callId!);
          const protocols = ["realtime", `openai-insecure-api-key.${token.value}`];
          if (token.projectId) protocols.push(`openai-project.${token.projectId}`);
          const upstream = new WebSocket(
            `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(env.OPENAI_MODEL)}`,
            protocols,
          );
          openaiSocket = upstream;

          upstream.addEventListener("open", () => {
            for (const audio of pendingAudio.splice(0)) {
              upstream.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
            }
            upstream.send(
              JSON.stringify({
                type: "response.create",
                response: {
                  instructions:
                    "Inicia la llamada ahora. Saluda, identifícate claramente como Volta, asistente de operaciones con inteligencia artificial, informa que la llamada puede ser grabada y continúa con el objetivo asignado.",
                },
              }),
            );
          });

          upstream.addEventListener("message", (upstreamMessage) => {
            const openaiEvent = parseOpenAIEvent(upstreamMessage.data);
            if (!openaiEvent || !streamSid) return;
            if (openaiEvent.type === "response.output_audio.delta" && openaiEvent.delta) {
              twilioSocket.send(JSON.stringify({ event: "media", streamSid, media: { payload: openaiEvent.delta } }));
            } else if (openaiEvent.type === "input_audio_buffer.speech_started") {
              twilioSocket.send(JSON.stringify({ event: "clear", streamSid }));
            } else if (openaiEvent.type === "session.created" && callId) {
              reportEvent(ctx, env, callId, "session.created", { sessionId: openaiEvent.session?.id });
            } else if (openaiEvent.type === "response.done" && callId) {
              reportEvent(ctx, env, callId, "response.done");
            } else if (openaiEvent.type === "error") {
              fail(openaiEvent.error?.message ?? "OpenAI Realtime error");
            }
          });

          upstream.addEventListener("error", () => fail("OpenAI WebSocket error"));
          upstream.addEventListener("close", () => closeSocket(twilioSocket, 1000, "OpenAI session ended"));
        })().catch((error: unknown) => fail(error instanceof Error ? error.message : "Relay initialization failed")),
      );
      return;
    }

    if (event.event === "media") {
      const audio = event.media.payload;
      if (openaiSocket?.readyState === WebSocket.OPEN) {
        openaiSocket.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
      } else if (pendingAudio.length < 150) {
        pendingAudio.push(audio);
      }
      return;
    }

    if (event.event === "stop") {
      if (callId) reportEvent(ctx, env, callId, "stream.stopped");
      if (openaiSocket) closeSocket(openaiSocket, 1000, "Twilio stream stopped");
      closeSocket(twilioSocket, 1000, "Twilio stream stopped");
    }
  });

  twilioSocket.addEventListener("error", () => fail("Twilio WebSocket error"));
  twilioSocket.addEventListener("close", () => {
    if (openaiSocket) closeSocket(openaiSocket, 1000, "Twilio disconnected");
  });

  return new Response(null, { status: 101, webSocket: client });
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "volta-realtime-relay", model: env.OPENAI_MODEL });
    }
    if (url.pathname !== "/twilio/") return new Response("Not found", { status: 404 });
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }
    return handleTwilioStream(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
