import "server-only";
import { tenantData } from "../workspace";
import { readShareToken } from "./share";

/** The record a shared link points at, or null when the link is bad, expired, or the record is gone or void. */
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
