import { z } from "zod";
import { createRealtimeClientSecret } from "@/lib/providers/openai-realtime";
import { authorizeRelayRequest } from "@/lib/server/relay-auth";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  callId: z.string().uuid(),
  transport: z.enum(["telephony", "whatsapp"]).default("telephony"),
});

export async function POST(request: Request) {
  try {
    if (!authorizeRelayRequest(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
    const { callId, transport } = bodySchema.parse(await request.json());
    const store = getStore();
    const snapshot = await store.getSnapshot();
    const call = snapshot.calls.find((item) => item.id === callId);
    if (!call) return Response.json({ error: "Call not found" }, { status: 404 });
    const carrier = snapshot.carriers.find((item) => item.id === call.carrierId);
    const secret = await createRealtimeClientSecret(snapshot, call, carrier, transport);
    return Response.json(
      {
        value: secret.value,
        expiresAt: secret.expires_at,
        projectId: process.env.OPENAI_PROJECT_ID?.trim() || null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error(JSON.stringify({ level: "error", message: "Realtime token creation failed", error: String(error) }));
    return Response.json({ error: "Realtime token creation failed" }, { status: 400 });
  }
}
