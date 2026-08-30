import { getStore } from "@/lib/store";
import { requireOperator } from "@/lib/server/auth";
import { apiError, ok } from "@/lib/server/http";

// Each action fans out to Supabase and the voice service. The platform default
// is far too short for that, and a killed function reaches the browser as an
// opaque "Failed to fetch" rather than an error anyone can act on.
export const maxDuration = 60;

export async function POST() {
  try {
    await requireOperator();
    return ok(await getStore().reset());
  } catch (error) {
    return apiError(error);
  }
}

