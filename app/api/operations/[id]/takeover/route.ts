import { takeOver } from "@/lib/services/operations";
import { requireOperator } from "@/lib/server/auth";
import { apiError, ok } from "@/lib/server/http";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireOperator();
    const { id } = await context.params;
    return ok(await takeOver(id));
  } catch (error) {
    return apiError(error);
  }
}
