import nodemailer from "nodemailer";
import { env } from "../config/env.js";

let transporter = null;
let loggedMissingConfig = false;

/** Lazily created, cached across calls — nodemailer's transporter is meant to be reused,
 *  not recreated per send (it can pool connections). Returns null (never throws) when SMTP
 *  isn't configured, same shape as webPush.js's ensureConfigured — every call site treats
 *  "no mailer configured" as a no-op-and-log, not a crash, since email is nice-to-have
 *  infrastructure here, not core money handling. */
function getTransporter() {
	if (transporter) return transporter;
	if (!env.smtp.host || !env.smtp.user || !env.smtp.pass) {
		if (!loggedMissingConfig) {
			console.log(
				"[mailer] SMTP_HOST/SMTP_USER/SMTP_PASS not configured — emails will be logged, not sent. See .env.example.",
			);
			loggedMissingConfig = true;
		}
		return null;
	}
	transporter = nodemailer.createTransport({
		service: "gmail",
		secure: env.smtp.secure,
		auth: { user: env.smtp.user, pass: env.smtp.pass },
	});
	return transporter;
}

/** Best-effort send — logs and swallows failures rather than throwing, so a flaky SMTP
 *  provider can never break the request that triggered the email (e.g. forgotPassword
 *  should still return its generic "check your email" response either way — see
 *  auth.service.js). Callers that need to know whether it actually sent can check the
 *  resolved value, but nothing currently depends on that. */
export async function sendMail({ to, subject, text, html }) {
	const t = getTransporter();
	if (!t) {
		console.log(
			`[mailer] (unsent — no SMTP configured) To: ${to} | Subject: ${subject}\n${text}`,
		);
		return false;
	}
	try {
		await t.sendMail({ from: env.smtp.from, to, subject, text, html });
		return true;
	} catch (err) {
		console.error("[mailer] sendMail failed:", err.message);
		return false;
	}
}

/** The one email this app currently sends. resetUrl already has the raw token embedded
 *  (see auth.service.js's forgotPassword) — this function itself never sees or needs the
 *  raw token, just the finished link. */
export async function sendPasswordResetEmail(toEmail, resetUrl) {
	const text = `Someone requested a password reset for your ChessFifa account.\n\nReset your password here (this link expires in 1 hour):\n${resetUrl}\n\nIf you didn't request this, you can safely ignore this email — your password won't change.`;
	const html = `
    <p>Someone requested a password reset for your ChessFifa account.</p>
    <p><a href="${resetUrl}">Click here to reset your password</a> (this link expires in 1 hour).</p>
    <p>If you didn't request this, you can safely ignore this email — your password won't change.</p>
  `;
	return sendMail({
		to: toEmail,
		subject: "Reset your ChessFifa password",
		text,
		html,
	});
}
