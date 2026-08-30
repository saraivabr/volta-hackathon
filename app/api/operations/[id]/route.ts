import { z } from "zod";
import { getStore } from "@/lib/store";
import { apiError, ok } from "@/lib/server/http";
import { requireOperator } from "@/lib/server/auth";

// Each action fans out to Supabase and the voice service. The platform default
// is far too short for that, and a killed function reaches the browser as an
// opaque "Failed to fetch" rather than an error anyone can act on.
export const maxDuration = 60;

const patchSchema = z.object({
  reference: z.string().trim().min(2).max(40).optional(),
  customer: z.string().trim().min(2).max(120).optional(),
  containerReference: z.string().trim().min(2).max(60).optional(),
  pickupLocation: z.string().trim().min(2).max(160).optional(),
  deliveryLocation: z.string().trim().min(2).max(160).optional(),
  pickupDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  pickupWindowStart: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  pickupWindowEnd: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  handoffPhoneE164: z.union([z.string().regex(/^\+[1-9]\d{7,14}$/), z.literal("")]).optional(),
  targetRate: z.number().positive().optional(),
  maximumRate: z.number().positive().optional(),
  negotiateRate: z.boolean().optional(),
  changePickupDay: z.boolean().optional(),
  acceptAccessorials: z.boolean().optional(),
  maximumCounters: z.number().int().min(0).max(5).optional(),
  carriers: z
    .array(
      z.object({
        id: z.string().min(1),
        name: z.string().trim().min(2).max(100),
        dispatcher: z.string().trim().min(2).max(100),
        phoneE164: z.string().regex(/^\+[1-9]\d{7,14}$/),
        email: z.union([z.string().email(), z.literal("")]).optional(),
      }),
    )
    .length(3)
    .optional(),
}).superRefine((input, context) => {
  if (input.targetRate !== undefined && input.maximumRate !== undefined && input.targetRate > input.maximumRate) {
    context.addIssue({ code: "custom", path: ["targetRate"], message: "Target rate cannot exceed the hard ceiling" });
  }
  if (input.pickupWindowStart && input.pickupWindowEnd && input.pickupWindowStart >= input.pickupWindowEnd) {
    context.addIssue({ code: "custom", path: ["pickupWindowStart"], message: "Pickup window start must be before its end" });
  }
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
    const {
      targetRate,
      maximumRate,
      negotiateRate,
      changePickupDay,
      acceptAccessorials,
      maximumCounters,
      carriers,
      ...operation
    } = input;
    return ok(
      await getStore().updateConfiguration(id, {
        ...operation,
        mandate: {
          ...(targetRate !== undefined ? { targetRate } : {}),
          ...(maximumRate !== undefined ? { maximumRate } : {}),
          ...(negotiateRate !== undefined ? { negotiateRate } : {}),
          ...(changePickupDay !== undefined ? { changePickupDay } : {}),
          ...(acceptAccessorials !== undefined ? { acceptAccessorials } : {}),
          ...(maximumCounters !== undefined ? { maximumCounters } : {}),
        },
        ...(carriers ? { carriers } : {}),
      }),
    );
  } catch (error) {
    return apiError(error);
  }
}
