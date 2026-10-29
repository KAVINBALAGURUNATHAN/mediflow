const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { sendMail, button } = require("./mailer");

// Shared password-reset flow for every role that has an email + password.
// Kept in one place so the security rules below cannot drift apart between
// patient and doctor implementations.
//
// Rules enforced here:
//   - only the SHA-256 hash of the token is persisted
//   - tokens expire after TTL_MINUTES and are single-use (cleared on success)
//   - requestReset always reports success, even for unknown addresses, so the
//     endpoint cannot be used to discover which emails are registered
const TTL_MINUTES = 60;
const MIN_PASSWORD_LENGTH = 8;

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function requestReset({ Model, email, role, resetPath }) {
  const normalized = String(email || "").trim().toLowerCase();

  // Generic reply used for every outcome - unknown address, no password set,
  // or a mail failure. The caller must not vary this by branch.
  const generic = {
    message: "If that email is registered, a reset link is on its way.",
  };

  if (!normalized) return generic;

  const user = await Model.findOne({ email: normalized }).select("+password");

  // Google-only patients have no password to reset; treat them like unknowns
  // rather than telling the caller the account exists but is passwordless.
  if (!user || !user.password) return generic;

  const token = crypto.randomBytes(32).toString("hex");
  user.resetTokenHash = hashToken(token);
  user.resetTokenExpires = new Date(Date.now() + TTL_MINUTES * 60 * 1000);
  await user.save();

  const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
  const link = `${base}${resetPath}?token=${token}&email=${encodeURIComponent(normalized)}`;

  // Deliberately not awaited. Awaiting made a registered address take as long
  // as the SMTP round-trip while an unknown one returned immediately, so the
  // response time revealed which emails exist - defeating the identical
  // response bodies above. Delivery failures are logged inside sendMail.
  sendMail({
    to: normalized,
    subject: `Reset your ${role} password`,
    heading: "Reset your password",
    bodyHtml: `
      <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#475569;">
        We received a request to reset the password for your ${role} account.
        This link expires in ${TTL_MINUTES} minutes and can be used once.
      </p>
      <p style="margin:0 0 20px;">${button(link, "Choose a new password")}</p>
      <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
        If you did not request this, you can ignore this email - your password
        will not change.
      </p>`,
  }).catch(() => {});

  return generic;
}

async function performReset({ Model, email, token, newPassword }) {
  const normalized = String(email || "").trim().toLowerCase();

  if (!normalized || !token || !newPassword) {
    return { ok: false, status: 400, message: "Email, token and new password are required" };
  }

  if (String(newPassword).length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      status: 400,
      message: `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    };
  }

  const user = await Model.findOne({ email: normalized }).select(
    "+resetTokenHash +resetTokenExpires"
  );

  const expected = user?.resetTokenHash;
  const supplied = hashToken(token);

  // Constant-time compare, guarded so mismatched lengths cannot throw.
  const matches =
    expected &&
    expected.length === supplied.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));

  if (!matches || !user.resetTokenExpires || user.resetTokenExpires < new Date()) {
    return { ok: false, status: 400, message: "This reset link is invalid or has expired" };
  }

  user.password = await bcrypt.hash(newPassword, 10);
  user.resetTokenHash = undefined;
  user.resetTokenExpires = undefined;
  await user.save();

  return { ok: true, status: 200, message: "Password updated. You can now sign in." };
}

module.exports = { requestReset, performReset, TTL_MINUTES, MIN_PASSWORD_LENGTH };
