import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { extract } from "@/lib/attachments";
import { MAX_ATTACHMENTS } from "@/lib/ndjson";

export const runtime = "nodejs";

/** Reads attached documents into text for the AI. Nothing is stored. */
export async function POST(request: Request) {
  if (!(await getSession())) return NextResponse.json({ message: "Please sign in first." }, { status: 401 });
  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("file") ?? []).filter((f): f is File => f instanceof File).slice(0, MAX_ATTACHMENTS);
  if (!files.length) return NextResponse.json({ message: "No file was attached." }, { status: 400 });
  const results = await Promise.all(files.map(extract));
  return NextResponse.json({
    attachments: results.flatMap((r) => (r.ok ? [r.attachment] : [])),
    errors: results.flatMap((r) => (r.ok ? [] : [{ name: r.name, message: r.message }])),
  });
}
