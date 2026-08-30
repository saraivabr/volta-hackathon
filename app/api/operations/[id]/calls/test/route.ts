import { z } from "zod";
import { startSingleQuoteCall } from "@/lib/services/operations";
import { requireOperator } from "@/lib/server/auth";
import { apiError, ok } from "@/lib/server/http";

// Each action fans out to Supabase and the voice service. The platform default
// is far too short for that, and a killed function reaches the browser as an
// opaque "Failed to fetch" rather than an error anyone can act on.
export const maxDuration = 60;

const bodySchema = z.object({
  carrierId: z.string().min(1),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireOperator();
    const { id } = await context.params;
    const { carrierId } = bodySchema.parse(await request.json());
    return ok(await startSingleQuoteCall(id, carrierId));
  } catch (error) {
    return apiError(error);
  }
}
