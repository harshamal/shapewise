import { NextResponse } from "next/server";
import { pdfName, renderPdf } from "@/lib/documents/pdf";
import { asDate, today, yearStart } from "@/lib/screens";
import { buildStatement, statementDocument, statementSnapshot } from "@/lib/statements";
import { loadWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

/** A customer statement as a PDF, for someone whose role can open customer statements. */
export async function GET(request: Request, { params }: { params: Promise<{ tenant: string; customer: string }> }) {
  const { tenant, customer } = await params;
  const ws = await loadWorkspace(tenant);
  if (!ws.compiled.can(ws.actor.roleKey, "statements", "view")) return NextResponse.json({ message: "Your role can't open statements." }, { status: 403 });
  const q = new URL(request.url).searchParams;
  const day = today(ws);
  const from = asDate(q.get("from") ?? undefined, yearStart(ws, day));
  const to = asDate(q.get("to") ?? undefined, day);
  const st = buildStatement(await statementSnapshot(ws), customer, from, to, day);
  if (!st) return NextResponse.json({ message: "That customer doesn't exist." }, { status: 404 });
  const doc = statementDocument(ws, st);
  const pdf = await renderPdf(doc);
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${q.get("download") === "1" ? "attachment" : "inline"}; filename="${pdfName({ ...doc, number: `Statement ${st.name}` })}"`,
      "cache-control": "private, no-store",
    },
  });
}
