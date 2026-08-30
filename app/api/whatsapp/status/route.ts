import QRCode from "qrcode";
import { getWaCallsStatus, isWaCallsConfigured, pairWaCallsSession } from "@/lib/providers/wacalls";
import { requireOperator, requireSession } from "@/lib/server/auth";

// Each action fans out to Supabase and the voice service. The platform default
// is far too short for that, and a killed function reaches the browser as an
// opaque "Failed to fetch" rather than an error anyone can act on.
export const maxDuration = 60;

export const dynamic = "force-dynamic";

// An expired session is not a service outage; reporting it as one sent the last
// diagnosis chasing the voice relay instead of the cookie.
function statusError(error: unknown) {
  const unauthorized = error instanceof Error && error.message === "UNAUTHORIZED";
  return Response.json(
    { error: unauthorized ? "Unauthorized" : String(error) },
    { status: unauthorized ? 401 : 503 },
  );
}

async function responseForStatus(repair = false) {
  if (!isWaCallsConfigured()) {
    return Response.json({ data: { configured: false, paired: false, state: "not_configured" } });
  }
  const detail = repair ? await pairWaCallsSession() : await getWaCallsStatus();
  const qrDataUrl = detail.auth.qr
    ? await QRCode.toDataURL(detail.auth.qr, { width: 280, margin: 1, errorCorrectionLevel: "M" })
    : null;
  return Response.json({
    data: {
      configured: true,
      sessionId: detail.session.id,
      paired: detail.session.paired || detail.auth.paired,
      state: detail.auth.state || detail.session.state,
      qrDataUrl,
    },
  });
}

export async function GET() {
  try {
    await requireSession();
    return await responseForStatus();
  } catch (error) {
    return statusError(error);
  }
}

export async function POST() {
  try {
    await requireOperator();
    return await responseForStatus(true);
  } catch (error) {
    return statusError(error);
  }
}
