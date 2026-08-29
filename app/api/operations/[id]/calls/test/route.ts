import { z } from "zod";
import { startSingleQuoteCall } from "@/lib/services/operations";
import { requireOperator } from "@/lib/server/auth";
import { apiError, ok } from "@/lib/server/http";

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
