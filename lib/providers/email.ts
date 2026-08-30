import "server-only";

/**
 * The written recap has to survive the call. A phone number and a mailbox fail
 * in different ways — a handset is off, a number was mistyped, a message never
 * lands — so when both are configured the same terms leave by both routes and
 * either one is enough to hold the record.
 */
/**
 * Resend is the configured sender: an API key and a verified from-address are
 * all it needs, and it speaks plain HTTP so nothing is added to the bundle.
 */
export function isEmailConfigured() {
  if (process.env.VOLTA_DEMO_MODE === "true") return false;
  return Boolean(process.env.RESEND_API_KEY?.trim() && process.env.RECAP_FROM_EMAIL?.trim());
}

export async function sendRecapEmail(to: string, subject: string, body: string) {
  const key = process.env.RESEND_API_KEY?.trim();
  const from = process.env.RECAP_FROM_EMAIL?.trim();
  if (!key || !from) throw new Error("Email recap is not configured");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, text: body }),
    signal: AbortSignal.timeout(15_000),
  });
  const payload = (await response.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!response.ok || !payload.id) {
    throw new Error(payload.message ?? `Email recap failed (${response.status})`);
  }
  return { messageId: payload.id };
}
