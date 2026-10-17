import "server-only";
import type { Attachment } from "@shapewise/ai";

/**
 * Text out of the documents people attach, so the model can read them:
 * PDF (text layer), Excel, CSV and plain text. Photos and scans don't come
 * here; the browser downscales them and the model looks at them directly.
 */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Per document, so a long price list can't crowd out the conversation. */
const MAX_CHARS = 24_000;

const TEXT_TYPES = /^(text\/|application\/(json|xml|csv))/;

export type Extracted = { ok: true; attachment: Attachment } | { ok: false; name: string; message: string };

function cap(text: string): string {
  const t = text.replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return t.length > MAX_CHARS ? `${t.slice(0, MAX_CHARS)}\n[Cut off: the rest of the document was too long to read]` : t;
}

function kindOf(file: File): "pdf" | "xlsx" | "text" | "image" | "unknown" {
  const name = file.name.toLowerCase();
  if (file.type === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (name.endsWith(".xlsx") || file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  if (TEXT_TYPES.test(file.type) || /\.(csv|txt|md|json|tsv|xml)$/.test(name)) return "text";
  if (file.type.startsWith("image/")) return "image";
  return "unknown";
}

export async function extract(file: File): Promise<Extracted> {
  const name = file.name.slice(0, 200) || "file";
  if (file.size > MAX_FILE_BYTES) return { ok: false, name, message: `${name} is over 10 MB.` };
  const kind = kindOf(file);
  try {
    switch (kind) {
      case "pdf": {
        const { extractText, getDocumentProxy } = await import("unpdf");
        const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
        const { totalPages, text } = await extractText(pdf, { mergePages: true });
        const body = cap(Array.isArray(text) ? text.join("\n\n") : text);
        if (body.length < 20) return { ok: false, name, message: `${name} looks like a scan with no text in it. Attach a photo of the page instead and I'll read it.` };
        return { ok: true, attachment: { name, mime: "application/pdf", kind: "text", text: body, pages: totalPages } };
      }
      case "xlsx": {
        const { default: readSheet, readSheetNames } = await import("read-excel-file/node");
        const buf = Buffer.from(await file.arrayBuffer());
        const sheets = (await readSheetNames(buf)).slice(0, 8);
        const parts: string[] = [];
        for (const sheet of sheets) {
          const rows = await readSheet(buf, { sheet });
          const lines = rows
            .filter((r) => r.some((c) => c !== null && c !== ""))
            .slice(0, 400)
            .map((r) => r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : c === null ? "" : String(c).replace(/[\t\n]+/g, " "))).join("\t"));
          if (lines.length) parts.push(`Sheet "${sheet}":\n${lines.join("\n")}`);
        }
        if (!parts.length) return { ok: false, name, message: `${name} has no data in it.` };
        return { ok: true, attachment: { name, mime: file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", kind: "text", text: cap(parts.join("\n\n")), pages: sheets.length } };
      }
      case "text": {
        const body = cap(await file.text());
        if (!body) return { ok: false, name, message: `${name} is empty.` };
        return { ok: true, attachment: { name, mime: file.type || "text/plain", kind: "text", text: body } };
      }
      case "image":
        return { ok: false, name, message: "Images are read in the browser." };
      default:
        return { ok: false, name, message: `${name} isn't a file I can read. Use PDF, Excel (.xlsx), CSV, text or a photo.` };
    }
  } catch (e) {
    console.warn("attachments: couldn't read", name, e instanceof Error ? e.message : e);
    return { ok: false, name, message: `I couldn't read ${name}. If it's password protected or a scan, attach a photo instead.` };
  }
}
