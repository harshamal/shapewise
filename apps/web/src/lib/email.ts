import "server-only";

/**
 * Outgoing email through Resend (RESEND_API_KEY, sender EMAIL_FROM on a
 * domain verified in Resend). Used for account confirmation and for sending
 * documents with their PDF attached.
 */

export interface Email {
  to: string;
  subject: string;
  text: string;
  html?: string;
  /** Shown as the sender's name in front of EMAIL_FROM's address, e.g. the business name. */
  fromName?: string;
  replyTo?: string;
  attachments?: { filename: string; content: Buffer }[];
}

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);

export async function sendEmail(m: Email): Promise<{ ok: boolean; message?: string }> {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from) return { ok: false, message: "Email isn't set up on this server." };
  // "Name <address>": keep the verified address, put the business's name in front when given.
  const address = from.match(/<([^>]+)>/)?.[1] ?? from;
  const sender = m.fromName ? `${m.fromName.replace(/[<>"]/g, "")} <${address}>` : from;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({
      from: sender,
      to: [m.to],
      subject: m.subject,
      text: m.text,
      ...(m.html ? { html: m.html } : {}),
      ...(m.replyTo ? { reply_to: m.replyTo } : {}),
      ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) } : {}),
    }),
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => ({}))) as { message?: string };
    console.warn("email: Resend refused", r.status, body.message);
    return { ok: false, message: "The email couldn't be sent. Try again in a moment." };
  }
  return { ok: true };
}

/** A plain, readable HTML version of a short message with one button. */
export function simpleHtml(opts: { heading: string; lines: string[]; button?: { label: string; href: string }; footer?: string }): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html><html><body style="margin:0;background:#f6f5f2;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1a17">
<div style="max-width:480px;margin:0 auto;padding:32px 24px">
<p style="font-size:15px;font-weight:600;margin:0 0 24px">Shapewise</p>
<div style="background:#fff;border:1px solid #e4e0d8;border-radius:12px;padding:24px">
<h1 style="font-size:18px;font-weight:600;margin:0 0 12px">${esc(opts.heading)}</h1>
${opts.lines.map((l) => `<p style="font-size:14px;line-height:1.55;margin:0 0 12px;color:#45413b">${esc(l)}</p>`).join("")}
${opts.button ? `<p style="margin:20px 0 8px"><a href="${esc(opts.button.href)}" style="display:inline-block;background:#2b4acb;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:10px 18px;border-radius:8px">${esc(opts.button.label)}</a></p><p style="font-size:12px;color:#8a857c;margin:12px 0 0;word-break:break-all">Or paste this link into your browser: ${esc(opts.button.href)}</p>` : ""}
</div>
${opts.footer ? `<p style="font-size:12px;color:#8a857c;margin:16px 4px 0">${esc(opts.footer)}</p>` : ""}
</div></body></html>`;
}
