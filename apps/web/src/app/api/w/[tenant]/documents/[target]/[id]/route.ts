import { NextResponse } from "next/server";
import { documentFor } from "@/lib/documents/load";
import { pdfName, renderPdf } from "@/lib/documents/pdf";
import { getRecord } from "@/lib/records";
import { loadWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

/** The PDF of a record, for someone signed in whose role can see it. `?download=1` saves instead of opening. */
export async function GET(request: Request, { params }: { params: Promise<{ tenant: string; target: string; id: string }> }) {
  const { tenant, target, id } = await params;
  const ws = await loadWorkspace(tenant);
  const t = ws.compiled.targets.get(target);
  if (!t || !t.printable || !ws.compiled.can(ws.actor.roleKey, t.submodule, "view")) return NextResponse.json({ message: "There's no document to print here." }, { status: 404 });
  const rec = await getRecord(ws, t, id);
  const doc = await documentFor(ws, t, rec);
  const pdf = await renderPdf(doc);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${pdfName(doc)}"`,
      "cache-control": "private, no-store",
    },
  });
}
