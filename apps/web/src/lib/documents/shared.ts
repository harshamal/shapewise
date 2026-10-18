import "server-only";
import { buildStatement, statementDocument, statementSnapshot } from "../statements";
import { tenantData } from "../workspace";
import { documentFor } from "./load";
import type { DocumentModel } from "./model";
import { readShareToken } from "./share";

/** A statement's link names the customer and the dates: "customer~from~to". */
export const statementId = (customer: string, from: string, to: string) => `${customer}~${from}~${to}`;

/** The record a shared link points at, or null when the link is bad, expired, or the record is gone. */
export async function sharedRecord(token: string) {
  const claim = readShareToken(token);
  if (!claim) return null;
  const src = await tenantData(claim.tenant);
  const t = src?.compiled.targets.get(claim.target);
  if (!src || !t || !t.printable) return null;
  const rec = await src.store.read(src.tenant, (tx) => tx.get(claim.target, claim.id));
  if (!rec) return null;
  return { src, t, rec, claim };
}

/** The document behind any shared link: a record's document, or a customer statement. */
export async function sharedDocument(token: string): Promise<DocumentModel | null> {
  const claim = readShareToken(token);
  if (!claim) return null;
  if (claim.target === "statement") {
    const src = await tenantData(claim.tenant);
    const [customer, from, to] = claim.id.split("~");
    if (!src || !customer || !from || !to) return null;
    const st = buildStatement(await statementSnapshot(src), customer, from, to, to);
    return st ? statementDocument(src, st) : null;
  }
  const found = await sharedRecord(token);
  return found ? documentFor(found.src, found.t, found.rec) : null;
}
