import "server-only";
import type { Blueprint } from "@shapewise/blueprint";
import type { CTarget, Compiled, Store, StoredRecord } from "@shapewise/runtime";
import { refTitles } from "../records";
import { buildDocument, partyField, type DocumentModel } from "./model";

/** The pieces of a workspace a document needs; a signed-in workspace or a shared link's tenant data. */
export interface DocSource {
  tenant: string;
  bp: Blueprint;
  compiled: Compiled;
  store: Store;
}

/** Builds the document for a record that the caller has already checked may be seen. */
export async function documentFor(src: DocSource, t: CTarget, rec: StoredRecord): Promise<DocumentModel> {
  const refs = await refTitles(src, t, [rec]);
  const pf = partyField(t);
  let party: Parameters<typeof buildDocument>[0]["party"];
  const pid = pf && rec.data[pf.key];
  if (pf && typeof pid === "string") {
    const pt = src.compiled.targets.get(pf.to!);
    const prec = pt && (await src.store.read(src.tenant, (tx) => tx.get(pf.to!, pid)));
    if (pt && prec) party = { field: pf, rec: prec, t: pt };
  }
  return buildDocument({ bp: src.bp, t, rec, refs, party });
}

/** The email address on the document's customer or vendor, if any. */
export async function partyEmail(src: DocSource, t: CTarget, rec: StoredRecord): Promise<string | undefined> {
  const pf = partyField(t);
  const pid = pf && rec.data[pf.key];
  if (!pf || typeof pid !== "string") return undefined;
  const prec = await src.store.read(src.tenant, (tx) => tx.get(pf.to!, pid));
  const e = prec?.data.email;
  return typeof e === "string" && e.includes("@") ? e : undefined;
}

/** The party's phone, in the international form wa.me wants (Sri Lankan numbers assumed for a leading 0). */
export async function partyPhone(src: DocSource, t: CTarget, rec: StoredRecord): Promise<string | undefined> {
  const pf = partyField(t);
  const pid = pf && rec.data[pf.key];
  if (!pf || typeof pid !== "string") return undefined;
  const prec = await src.store.read(src.tenant, (tx) => tx.get(pf.to!, pid));
  const raw = typeof prec?.data.phone === "string" ? prec.data.phone : "";
  let digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return undefined;
  if (digits.startsWith("+")) digits = digits.slice(1);
  else if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0") && src.bp.business.country === "LK") digits = `94${digits.slice(1)}`;
  return digits.length >= 8 ? digits : undefined;
}
