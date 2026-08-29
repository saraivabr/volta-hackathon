import { getStore } from "@/lib/store";
import { requireOperator } from "@/lib/server/auth";
import { apiError, ok } from "@/lib/server/http";

export async function POST() {
  try {
    await requireOperator();
    return ok(await getStore().reset());
  } catch (error) {
    return apiError(error);
  }
}

