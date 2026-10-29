import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { EnvelopeSimple, ArrowLeft, CheckCircle } from "@phosphor-icons/react";
import API from "../api/api";

const EASE = [0.16, 1, 0.3, 1];

// Shared by patients and doctors - `role` picks which endpoint is called and
// where the "back" link goes. Rendered outside the Sidebar/Header shell (see
// isPublicPatientPage in App.jsx), light-only like the other auth screens.
//
// The success panel is shown for ANY successful response, including unknown
// addresses: the backend deliberately cannot tell us whether the account
// exists (see utils/passwordReset), and echoing that distinction in the UI
// would reintroduce the enumeration leak the API avoids.
function ForgotPassword({ role = "patient" }) {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const isDoctor = role === "doctor";
  const backTo = isDoctor ? "/doctor-login" : "/patient-login";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!email.trim()) {
      setError("Enter the email address on your account.");
      return;
    }

    try {
      setLoading(true);
      await API.post(`/${role}/forgot-password`, { email: email.trim() });
      setSent(true);
    } catch (err) {
      setError(err.response?.data?.message || "Could not send the reset email. Try again.");
    } finally {
      setLoading(false);
    }
  };

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
              <span className="text-white font-bold text-xs">QC</span>
            </div>
            <span className="text-lg font-semibold text-gray-900 tracking-tight">Queue Cure</span>
          </Link>
          <h1 className="text-[28px] font-bold text-[#111827] tracking-tight">
            {sent ? "Check your email" : "Forgot your password?"}
          </h1>
          <p className="text-sm text-[#6B7280] mt-2">
            {sent
              ? "If that email is registered, a reset link is on its way."
              : "Enter your email and we'll send you a link to set a new one."}
          </p>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08, ease: EASE }}
          className="bg-white rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] p-6 sm:p-8"
        >
          {sent ? (
            <div className="text-center">
              <div className="w-12 h-12 rounded-xl bg-success-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle weight="duotone" className="w-6 h-6 text-success-600" aria-hidden />
              </div>
              <p className="text-sm text-gray-600 leading-relaxed">
                The link expires in 60 minutes and can be used once. If it doesn't
                arrive, check your spam folder.
              </p>
              <button
                type="button"
                onClick={() => navigate(backTo)}
                className="mt-6 w-full h-12 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150"
              >
                Back to sign in
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block text-[13px] font-medium text-gray-700 mb-1.5">
                  Email
                </label>
                <div className="relative">
                  <EnvelopeSimple
                    weight="duotone"
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 w-[18px] h-[18px] text-gray-500"
                    aria-hidden
                  />
                  <input
                    id="reset-email"
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (error) setError("");
                    }}
                    autoFocus
                    autoComplete="email"
                    aria-invalid={!!error}
                    placeholder={isDoctor ? "you@hospital.com" : "you@example.com"}
                    className={`w-full h-11 pl-11 pr-3.5 rounded-lg border bg-white text-[15px] text-gray-900 placeholder:text-gray-400 outline-none transition duration-150 ${
                      error
                        ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-500/10"
                        : "border-gray-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
                    }`}
                  />
                </div>
                {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
              </div>

              <motion.button
                type="submit"
                disabled={loading}
                whileTap={reduceMotion ? {} : { scale: 0.98 }}
                className="w-full h-12 mt-2 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none"
              >
                {loading ? "Sending…" : "Send reset link"}
              </motion.button>
            </form>
          )}
        </motion.div>

        <div className="mt-6 text-center">
          <Link
            to={backTo}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft weight="bold" className="w-4 h-4" aria-hidden />
            Back to {isDoctor ? "doctor" : "patient"} sign in
          </Link>
        </div>
      </div>
    </div>
  );
}

export default ForgotPassword;
