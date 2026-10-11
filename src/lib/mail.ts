import nodemailer, { type Transporter } from "nodemailer";

export type Mail = { to: string; subject: string; text: string; html: string };

/** Mails captured in memory when MAIL_TRANSPORT=memory (tests and browser tests). */
export const outbox: Mail[] = [];

type Sender = (m: Mail) => Promise<void>;
let override: Sender | null = null;
/** Test hook: replace the real sender. */
export function setMailSender(s: Sender | null) { override = s; }

export const mailMode = (): "memory" | "smtp" | "off" =>
  process.env.MAIL_TRANSPORT === "memory" ? "memory" : process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS ? "smtp" : "off";

export const mailConfigured = () => mailMode() !== "off";

/** Email verification is enforced only when the server can actually send email, so a half-configured server never locks people out. */
export const verificationRequired = () => mailConfigured() && process.env.REQUIRE_EMAIL_VERIFICATION !== "false";

/**
 * Public base URL used inside emailed links. Taken from APP_URL, never from request headers in
 * production (a forged Host header could otherwise point a reset link at an attacker's site).
 */
export function appUrl(): string | null {
  const u = process.env.APP_URL?.trim().replace(/\/+$/, "");
  if (u) return u;
  return process.env.NODE_ENV === "production" ? null : "http://localhost:3000";
}

let transport: Transporter | null = null;

export async function sendMail(m: Mail): Promise<void> {
  if (override) return override(m);
  const mode = mailMode();
  if (mode === "memory") { outbox.push(m); if (outbox.length > 200) outbox.shift(); return; }
  if (mode === "off") throw new Error("Email is not configured (set SMTP_HOST, SMTP_USER, SMTP_PASS)");
  transport ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    secure: Number(process.env.SMTP_PORT ?? 465) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  await transport.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: m.to, subject: m.subject, text: m.text, html: m.html });
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** One simple, bilingual (English + Nepali) email with a single button. */
export function actionEmail(opts: { to: string; subjectEn: string; subjectNe: string; headingEn: string; headingNe: string; bodyEn: string; bodyNe: string; buttonEn: string; buttonNe: string; url: string; noteEn: string; noteNe: string }): Mail {
  const text = `${opts.headingEn}\n\n${opts.bodyEn}\n${opts.url}\n\n${opts.noteEn}\n\n---\n\n${opts.headingNe}\n\n${opts.bodyNe}\n${opts.url}\n\n${opts.noteNe}\n`;
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,'Noto Sans Devanagari',sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#fff;border:1px solid #cbd5e1;border-radius:8px">
<tr><td style="padding:24px"><div style="font-size:18px;font-weight:700;color:#1d4ed8">KusBill</div>
<h2 style="margin:16px 0 8px;font-size:18px">${esc(opts.headingEn)}</h2><p style="margin:0 0 16px;line-height:1.5">${esc(opts.bodyEn)}</p>
<p style="margin:0 0 16px"><a href="${esc(opts.url)}" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600">${esc(opts.buttonEn)} / ${esc(opts.buttonNe)}</a></p>
<p style="margin:0 0 16px;font-size:13px;color:#475569">${esc(opts.noteEn)}</p><hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0">
<h2 style="margin:0 0 8px;font-size:18px">${esc(opts.headingNe)}</h2><p style="margin:0 0 12px;line-height:1.6">${esc(opts.bodyNe)}</p>
<p style="margin:0;font-size:13px;color:#475569">${esc(opts.noteNe)}</p>
<p style="margin:16px 0 0;font-size:12px;color:#64748b;word-break:break-all">${esc(opts.url)}</p></td></tr></table></td></tr></table></body></html>`;
  return { to: opts.to, subject: `${opts.subjectEn} / ${opts.subjectNe}`, text, html };
}
