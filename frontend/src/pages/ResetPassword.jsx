import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { WarningCircle, CheckCircle } from "@phosphor-icons/react";
import API from "../api/api";

const EASE = [0.16, 1, 0.3, 1];
const MIN_LENGTH = 8;

// Landing page for the emailed reset link. `token` and `email` arrive as query
// params; the token is single-use and expires after an hour, both enforced
// server-side in utils/passwordReset - this page only mirrors the rules for
// immediate feedback and never decides validity itself.
function ResetPassword({ role = "patient" }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const [params] = useSearchParams();

  const token = params.get("token") || "";
  const email = params.get("email") || "";
  const isDoctor = role === "doctor";
  const loginPath = isDoctor ? "/doctor-login" : "/patient-login";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const linkIsUsable = Boolean(token && email);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (password.length < MIN_LENGTH) {
      setError(`Password must be at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    try {
      setLoading(true);
      await API.post(`/${role}/reset-password`, { email, token, newPassword: password });
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || "Could not reset your password. Try again.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = (invalid) =>
    `w-full h-11 px-3.5 rounded-lg border bg-white text-[15px] text-gray-900 placeholder:text-gray-400 outline-none transition duration-150 ${
      invalid
        ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-500/10"
        : "border-gray-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
    }`;

  return (
    <div className="relative min-h-[100dvh] flex items-center justify-center px-4 py-16 bg-[#F8FAFC]">
      <div className="relative w-full max-w-[420px]">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="text-center mb-6"
        >
          <Link to="/" className="inline-flex items-center gap-2 mb-6">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">MF</span>
            </div>
            <span className="text-lg font-semibold text-gray-900 tracking-tight">MediFlow</span>
          </Link>
          <h1 className="text-[28px] font-bold text-[#111827] tracking-tight">
            {done ? "Password updated" : "Choose a new password"}
          </h1>
          {!done && email && (
            <p className="text-sm text-[#6B7280] mt-2">
              for <span className="font-medium text-gray-700">{email}</span>
            </p>
          )}
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08, ease: EASE }}
          className="bg-white rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] p-6 sm:p-8"
        >
          {!linkIsUsable ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-warning-50 flex items-center justify-center mx-auto mb-4">
                <WarningCircle weight="duotone" className="w-6 h-6 text-warning-600" aria-hidden />
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                This reset link is incomplete. Request a new one and open the most
                recent email.
              </p>
              <button
                type="button"
                onClick={() => navigate(isDoctor ? "/doctor-forgot-password" : "/forgot-password")}
                className="mt-6 w-full h-12 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150"
              >
                Request a new link
              </button>
            </div>
          ) : done ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-success-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle weight="duotone" className="w-6 h-6 text-success-600" aria-hidden />
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                Your password has been changed. Sign in with your new password.
              </p>
              <button
                type="button"
                onClick={() => navigate(loginPath)}
                className="mt-6 w-full h-12 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150"
              >
                Go to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor="new-password" className="block text-[13px] font-medium text-gray-700 mb-1.5">
                  New password
                </label>
                <input
                  id="new-password"
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (error) setError("");
                  }}
                  autoFocus
                  autoComplete="new-password"
                  placeholder={`At least ${MIN_LENGTH} characters`}
                  className={inputCls(!!error)}
                />
              </div>

              <div>
                <label htmlFor="confirm-password" className="block text-[13px] font-medium text-gray-700 mb-1.5">
                  Confirm password
                </label>
                <input
                  id="confirm-password"
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    if (error) setError("");
                  }}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  className={inputCls(!!error)}
                />
                {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
              </div>

              <label className="flex items-center gap-2 text-[13px] text-gray-600 select-none">
                <input
                  type="checkbox"
                  checked={show}
                  onChange={(e) => setShow(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500/30"
                />
                Show passwords
              </label>

              <motion.button
                type="submit"
                disabled={loading}
                whileTap={reduceMotion ? {} : { scale: 0.98 }}
                className="w-full h-12 mt-2 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none"
              >
                {loading ? "Updating…" : "Update password"}
              </motion.button>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}

export default ResetPassword;
