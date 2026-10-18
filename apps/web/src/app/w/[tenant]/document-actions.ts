"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { documentMessage } from "@/lib/documents/model";
import { documentFor, partyEmail, partyPhone } from "@/lib/documents/load";
import { pdfName, renderPdf } from "@/lib/documents/pdf";
import { shareToken } from "@/lib/documents/share";
import { statementId } from "@/lib/documents/shared";
import { asDate, today, yearStart } from "@/lib/screens";
import { buildStatement, statementDocument, statementSnapshot } from "@/lib/statements";
import { emailConfigured, sendEmail } from "@/lib/email";
import { getRecord } from "@/lib/records";
import { loadWorkspace, type Workspace } from "@/lib/workspace";

/**
 * Sending documents: a signed link anyone can open for 30 days, ready to go
 * by WhatsApp or email. Email goes out with the PDF attached when the server
 * has email set up (Resend); otherwise the person's own mail app
 * opens with the message written.
 */

export interface ShareInfo {
  ok: boolean;
  message?: string;
  link?: string;
  /** The message to send, with the link in it. */
  text?: string;
  subject?: string;
  email?: string;
  whatsapp?: string;
  /** The server can send the email itself, with the PDF attached. */
  canEmail?: boolean;
}

const Id = z.string().min(1).max(120);

async function open(tenant: string, target: string, id: string) {
  const ws = await loadWorkspace(tenant);
  const t = ws.compiled.targets.get(Id.parse(target));
  if (!t || !t.printable || !ws.compiled.can(ws.actor.roleKey, t.submodule, "view")) return null;
  const rec = await getRecord(ws, t, Id.parse(id));
  return { ws, t, rec };
}

async function origin() {
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host")}`;
}

export async function shareDocument(tenant: string, target: string, id: string): Promise<ShareInfo> {
  const found = await open(tenant, target, id);
  if (!found) return { ok: false, message: "This record can't be shared." };
  const { ws, t, rec } = found;
  let token: string;
  try {
    token = shareToken(tenant, t.target, rec.id);
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Sharing isn't set up." };
  }
  const link = `${await origin()}/d/${token}`;
  const doc = await documentFor(ws, t, rec);
  const [email, phone] = await Promise.all([partyEmail(ws, t, rec), partyPhone(ws, t, rec)]);
  const text = documentMessage(doc, link);
  return {
    ok: true,
    link,
    text,
    subject: `${doc.title} ${doc.number} from ${doc.business.name}`,
    email,
    whatsapp: `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(text)}`,
    canEmail: emailConfigured(),
  };
}

const EmailInput = z.object({ to: z.string().trim().email().max(200), message: z.string().trim().max(4000) });

/** Emails the document with its PDF attached, from the server's mail account. */
export async function emailDocument(tenant: string, target: string, id: string, input: { to: string; message: string }): Promise<{ ok: boolean; message: string }> {
  const found = await open(tenant, target, id);
  if (!found) return { ok: false, message: "This record can't be sent." };
  const parsed = EmailInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };
  if (!emailConfigured()) return { ok: false, message: "Email sending isn't set up on this server yet." };
  if (found.ws.demo) return { ok: false, message: "Demo workspaces don't send real emails." };
  const { ws, t, rec } = found;
  const doc = await documentFor(ws, t, rec);
  const pdf = await renderPdf(doc);
  const sent = await sendEmail({ fromName: ws.bp.business.name, replyTo: ws.bp.business.email || undefined, to: parsed.data.to, subject: `${doc.title} ${doc.number} from ${ws.bp.business.name}`, text: parsed.data.message, attachments: [{ filename: pdfName(doc), content: pdf }] });
  if (!sent.ok) return { ok: false, message: sent.message ?? "The email couldn't be sent." };
  await audit(ws, t.target, rec.id, `${doc.title} ${doc.number} emailed to ${parsed.data.to}`);
  return { ok: true, message: `Sent to ${parsed.data.to}.` };
}

async function audit(ws: Workspace, target: string, recordId: string, summary: string) {
  await ws.store.write(ws.tenant, async (tx) => {
    tx.audit({ id: `aud_${crypto.randomUUID()}`, at: new Date().toISOString(), commandId: crypto.randomUUID(), actor: { id: ws.actor.id, name: ws.actor.displayName, kind: ws.actor.kind, channel: "web", roleKey: ws.actor.roleKey }, target, recordId, action: "send", summary });
  });
}

/* ------------------------------------------------------------- statements */

async function openStatement(tenant: string, customer: string, from: string, to: string) {
  const ws = await loadWorkspace(tenant);
  if (!ws.compiled.can(ws.actor.roleKey, "statements", "view")) return null;
  const day = today(ws);
  const range = { from: asDate(from, yearStart(ws, day)), to: asDate(to, day) };
  const st = buildStatement(await statementSnapshot(ws), Id.parse(customer), range.from, range.to, day);
  return st ? { ws, st, doc: statementDocument(ws, st) } : null;
}

/** A link to a customer's statement for these dates, ready for WhatsApp or email. */
export async function shareStatement(tenant: string, customer: string, from: string, to: string): Promise<ShareInfo> {
  const found = await openStatement(tenant, customer, from, to);
  if (!found) return { ok: false, message: "This statement can't be shared." };
  const { st, doc } = found;
  let token: string;
  try {
    token = shareToken(tenant, "statement", statementId(st.customer.id, st.from, st.to));
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "Sharing isn't set up." };
  }
  const link = `${await origin()}/d/${token}`;
  const email = typeof st.customer.data.email === "string" && st.customer.data.email.includes("@") ? st.customer.data.email : undefined;
  const phone = typeof st.customer.data.phone === "string" ? st.customer.data.phone.replace(/[^\d]/g, "").replace(/^0/, found.ws.bp.business.country === "LK" ? "94" : "0") : "";
  const text = `Hello ${st.name},\n\nHere is your statement from ${doc.business.name} for ${doc.number}. The balance due is ${doc.totals.at(-1)!.value}.\n\nView or download it here: ${link}\n\nThank you.\n${doc.business.name}`;
  return { ok: true, link, text, subject: `Statement from ${doc.business.name}`, email, whatsapp: `https://wa.me/${phone.length >= 8 ? phone : ""}?text=${encodeURIComponent(text)}`, canEmail: emailConfigured() };
}

export async function emailStatement(tenant: string, customer: string, range: { from: string; to: string }, input: { to: string; message: string }): Promise<{ ok: boolean; message: string }> {
  const found = await openStatement(tenant, customer, range.from, range.to);
  if (!found) return { ok: false, message: "This statement can't be sent." };
  const parsed = EmailInput.safeParse(input);
  if (!parsed.success) return { ok: false, message: "Enter a valid email address." };
  if (!emailConfigured()) return { ok: false, message: "Email sending isn't set up on this server yet." };
  if (found.ws.demo) return { ok: false, message: "Demo workspaces don't send real emails." };
  const { ws, st, doc } = found;
  const sent = await sendEmail({ fromName: ws.bp.business.name, replyTo: ws.bp.business.email || undefined, to: parsed.data.to, subject: `Statement from ${ws.bp.business.name}`, text: parsed.data.message, attachments: [{ filename: pdfName({ ...doc, number: `Statement ${st.name}` }), content: await renderPdf(doc) }] });
  if (!sent.ok) return { ok: false, message: sent.message ?? "The email couldn't be sent." };
  await audit(ws, "customer", st.customer.id, `Statement emailed to ${parsed.data.to}`);
  return { ok: true, message: `Sent to ${parsed.data.to}.` };
}
