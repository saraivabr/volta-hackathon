import { HttpError } from "@/lib/server/http";
import { validateTwilioWebhook } from "@/lib/providers/twilio";

export async function verifiedTwilioForm(request: Request) {
  const formData = await request.formData();
  const params = Object.fromEntries([...formData.entries()].map(([key, value]) => [key, String(value)]));
  if (!validateTwilioWebhook(request, params)) throw new HttpError(403, "Invalid Twilio signature");
  return params;
}

