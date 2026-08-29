import QRCode from "qrcode";
import { getWaCallsStatus, isWaCallsConfigured, pairWaCallsSession } from "@/lib/providers/wacalls";
import { requireOperator } from "@/lib/server/auth";

export const dynamic = "force-dynamic";

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
    await requireOperator();
    return await responseForStatus();
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 503 });
  }
}

export async function POST() {
  try {
    await requireOperator();
    return await responseForStatus(true);
  } catch (error) {
    return Response.json({ error: String(error) }, { status: 503 });
  }
}
