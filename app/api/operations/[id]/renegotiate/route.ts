import { startRenegotiation } from "@/lib/services/operations";
import { requireOperator } from "@/lib/server/auth";
import { apiError, ok } from "@/lib/server/http";

// Fans out to the voice service like every other action route.
export const maxDuration = 60;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireOperator();
    const { id } = await context.params;
    return ok(await startRenegotiation(id));
  } catch (error) {
    return apiError(error);
  }
}
