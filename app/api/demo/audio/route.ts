const wavHeader = Buffer.from(
  "UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=",
  "base64",
);

export async function GET() {
  return new Response(wavHeader, {
    headers: { "Content-Type": "audio/wav", "Cache-Control": "public, max-age=3600" },
  });
}

