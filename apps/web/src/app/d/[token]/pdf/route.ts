import { NextResponse } from "next/server";
import { pdfName, renderPdf } from "@/lib/documents/pdf";
import { sharedDocument } from "@/lib/documents/shared";

export const runtime = "nodejs";

/** The PDF behind a shared link. The signed link is the permission. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const doc = await sharedDocument(token);
  if (!doc) return NextResponse.json({ message: "This link has expired or isn't valid." }, { status: 404 });
  const pdf = await renderPdf(doc);
  const download = new URL(request.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${download ? "attachment" : "inline"}; filename="${pdfName(doc)}"`,
      "cache-control": "private, no-store",
      "x-robots-tag": "noindex",
    },
  });
}
