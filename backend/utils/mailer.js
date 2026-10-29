const nodemailer = require("nodemailer");
const { Resend } = require("resend");

// Outgoing mail for password resets and appointment notifications.
//
// Three transports, chosen by whichever env vars are present, in order:
//
//   BREVO_API_KEY  -> Brevo, over HTTPS
//   RESEND_API_KEY -> Resend, over HTTPS
//   SMTP_USER/PASS -> Gmail SMTP
//
// An HTTPS provider is needed at all because Render's free tier blocks
// outbound SMTP ports (25/465/587), so Gmail can never connect from there.
//
// Brevo is first because it only requires verifying a single sender address,
// which means it can deliver to any recipient. Resend without a verified
// domain refuses every address except the account owner's, so it is fine for
// smoke tests but cannot mail real patients. SMTP stays as the local path
// since it needs no third-party account.
//
// With neither configured, sendMail logs what it would have sent and reports
// failure rather than throwing, so a booking or reset request never 500s
// because mail is unavailable. Callers treat mail as best-effort.
const BREVO_KEY = process.env.BREVO_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const HAS_SMTP = Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
const HAS_MAIL = Boolean(BREVO_KEY) || Boolean(RESEND_KEY) || HAS_SMTP;

const BRAND = "Queue Cure";

// Resend will only deliver to arbitrary recipients once a sending domain is
// verified; until then it accepts mail from its shared onboarding address.
const FROM = process.env.MAIL_FROM || `${BRAND} <onboarding@resend.dev>`;

const resend = !BREVO_KEY && RESEND_KEY ? new Resend(RESEND_KEY) : null;

let transporter = null;
if (!BREVO_KEY && !resend && HAS_SMTP) {
  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    // Fail fast where SMTP is blocked, instead of hanging until the caller
    // times out.
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 8000,
  });
}

// Inline styles only - every major mail client strips <style> blocks.
function wrap(heading, bodyHtml) {
  return `
  <div style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
      <div style="padding:20px 28px;border-bottom:1px solid #e2e8f0;">
        <span style="font-size:15px;font-weight:700;color:#0f172a;letter-spacing:-0.01em;">${BRAND}</span>
        <span style="font-size:12px;color:#64748b;"> &middot; Digital Appointment Platform</span>
      </div>
      <div style="padding:28px;">
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a;">${heading}</h1>
        ${bodyHtml}
      </div>
      <div style="padding:16px 28px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;">
        This is an automated message from ${BRAND}. Please do not reply.
      </div>
    </div>
  </div>`;
}

function button(href, label) {
  return `<a href="${href}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:999px;">${label}</a>`;
}

// Key/value rows used by the appointment mails.
function rows(pairs) {
  return `<table style="width:100%;border-collapse:collapse;margin:8px 0 20px;">${pairs
    .filter(([, v]) => v)
    .map(
      ([k, v]) =>
        `<tr>
           <td style="padding:8px 0;font-size:14px;color:#64748b;border-bottom:1px solid #f1f5f9;">${k}</td>
           <td style="padding:8px 0;font-size:14px;color:#0f172a;font-weight:600;text-align:right;border-bottom:1px solid #f1f5f9;">${v}</td>
         </tr>`
    )
    .join("")}</table>`;
}

// MAIL_FROM may be "Name <addr@x>" or a bare address; Brevo wants the two
// parts separately.
function parseFrom(value) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(value || "");
  if (m) return { name: m[1] || BRAND, email: m[2] };
  return { name: BRAND, email: (value || "").trim() };
}

async function sendViaBrevo({ to, subject, html }) {
  const sender = parseFrom(process.env.MAIL_FROM || process.env.SMTP_USER);
  if (!sender.email) {
    return { sent: false, reason: "brevo-needs-MAIL_FROM" };
  }

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_KEY,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender,
      to: [{ email: to }],
      subject,
      htmlContent: html,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return { sent: false, reason: `brevo ${res.status}: ${detail.slice(0, 200)}` };
  }
  return { sent: true, via: "brevo" };
}

async function sendMail({ to, subject, heading, bodyHtml }) {
  const html = wrap(heading, bodyHtml);

  if (!HAS_MAIL) {
    console.warn(`[mailer] not configured - would have sent "${subject}" to ${to}`);
    return { sent: false, reason: "not-configured" };
  }

  try {
    if (BREVO_KEY) {
      const r = await sendViaBrevo({ to, subject, html });
      if (!r.sent) console.error(`[mailer] "${subject}" to ${to}: ${r.reason}`);
      return r;
    }

    if (resend) {
      const { error } = await resend.emails.send({ from: FROM, to, subject, html });
      if (error) {
        console.error(`[mailer] resend rejected "${subject}" to ${to}:`, error.message || error);
        return { sent: false, reason: error.message || "resend-error" };
      }
      return { sent: true, via: "resend" };
    }

    await transporter.sendMail({
      from: `"${BRAND}" <${process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    return { sent: true, via: "smtp" };
  } catch (error) {
    console.error(`[mailer] failed to send "${subject}" to ${to}:`, error.message);
    return { sent: false, reason: error.message };
  }
}

module.exports = { sendMail, button, rows, HAS_MAIL };
