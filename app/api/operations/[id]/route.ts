import { z } from "zod";
import { getStore } from "@/lib/store";
import { apiError, ok } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/auth";

const patchSchema = z.object({
  pickupDate: z.string().optional(),
  pickupWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  pickupWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  targetRate: z.number().positive().optional(),
  maximumRate: z.number().positive().optional(),
  carrierPhones: z.record(z.string(), z.string().regex(/^\+[1-9]\d{7,14}$/)).optional(),
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireOperator();
    const { id } = await context.params;
    return ok(await getStore().getSnapshot(id));
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    await requireOperator();
    const { id } = await context.params;
    const input = patchSchema.parse(await request.json());
    const { targetRate, maximumRate, ...operation } = input;
    return ok(
      await getStore().updateConfiguration(id, {
        ...operation,
        mandate: {
          ...(targetRate !== undefined ? { targetRate } : {}),
          ...(maximumRate !== undefined ? { maximumRate } : {}),
        },
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
