import { handoffTexml, verifiedTelnyxForm } from "@/lib/providers/telnyx";
import { getStore } from "@/lib/store";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Reads the escalation to whoever answers, so the human arrives briefed. */
export async function POST(request: Request) {
  try {
    await verifiedTelnyxForm(request);
  } catch {
    return new Response("Forbidden", { status: 403 });
  }

  const snapshot = await getStore().getSnapshot();
  const escalation = snapshot.escalation;
  const lines = escalation
    ? [
        `Llamada de Pact, operación ${snapshot.operation.reference}, cliente ${snapshot.operation.customer}.`,
        `Se alcanzó el límite de autoridad. ${escalation.reason}.`,
        `Lo que piden: ${escalation.requestedChange}.`,
        "El agente no está autorizado a cambiar los términos acordados. La conversación completa está en el panel.",
      ]
    : ["Llamada de Pact. La escalación ya fue resuelta."];

  return new Response(handoffTexml(lines), {
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
