import { cookies } from "next/headers";
import { z } from "zod";
import { apiError, HttpError, ok } from "@/lib/server/http";
import { allowRequest } from "@/lib/server/rate-limit";
import { issueSession, SESSION_COOKIE, verifyAccessCode } from "@/lib/server/auth";

const inputSchema = z.object({ code: z.string().min(1).max(128) });

export async function POST(request: Request) {
  try {
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    if (!allowRequest(`login:${ip}`, 5, 60_000)) throw new HttpError(429, "Too many attempts");
    const { code } = inputSchema.parse(await request.json());
    const role = verifyAccessCode(code);
    if (!role) throw new HttpError(401, "Invalid access code");
    const jar = await cookies();
    jar.set(SESSION_COOKIE, await issueSession(role), {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 12,
    });
    return ok({ redirect: "/", role });
  } catch (error) {
    return apiError(error);
  }
}

