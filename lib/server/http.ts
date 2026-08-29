import { NextResponse } from "next/server";
import { ZodError } from "zod";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function apiError(error: unknown) {
  if (error instanceof HttpError) {
    return NextResponse.json({ ok: false, error: error.message }, { status: error.status });
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { ok: false, error: "Invalid request", details: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  console.error(JSON.stringify({ level: "error", message: "Unhandled API error", error: String(error) }));
  return NextResponse.json(
    { ok: false, error: error instanceof Error ? error.message : "Internal error" },
    { status: 500 },
  );
}

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

