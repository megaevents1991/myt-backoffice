/**
 * Shared outbound email (ZeptoMail SMTP).
 *
 * The same transport was previously constructed inline in each cron route that
 * sends mail; new senders should use this helper. Server-only - the credentials
 * are secrets.
 */

import nodemailer from "nodemailer";

export const DEFAULT_FROM = "alon@mega-events.co.il";

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (transporter) return transporter;

  const user = process.env.NEXT_SECRET_EMAIL_SERVER_USER;
  const pass = process.env.NEXT_SECRET_EMAIL_SERVER_PASSWORD;
  if (!user || !pass) {
    throw new Error("Missing NEXT_SECRET_EMAIL_SERVER_USER / _PASSWORD");
  }

  transporter = nodemailer.createTransport({
    host: "smtp.zeptomail.com",
    port: 587,
    auth: { user, pass },
  });
  return transporter;
}

export type SendMailInput = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
};

export async function sendMail(input: SendMailInput): Promise<void> {
  await getTransporter().sendMail({
    from: input.from ?? DEFAULT_FROM,
    to: input.to,
    subject: input.subject,
    html: input.html,
    text: input.text,
    replyTo: input.replyTo,
  });
}

/**
 * Absolute origin of this backoffice deployment, used to build links that are
 * emailed out. Set NEXT_PUBLIC_APP_URL in production; Vercel's own VERCEL_URL is
 * the fallback (it lacks a protocol and points at the deployment, not the alias).
 */
export function appOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel)
    return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/+$/, "")}`;
  return "http://localhost:3000";
}
