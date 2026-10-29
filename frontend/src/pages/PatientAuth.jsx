import { useState, useEffect, useRef } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ShieldCheck } from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";

const EASE = [0.16, 1, 0.3, 1];

// Renders Google's own GIS button rather than a custom trigger, as Google
// requires. Renders nothing when no client ID is configured.
function GoogleAuthSection({ onLoggedIn, onNeedsPhone }) {
  const buttonRef = useRef(null);
  const toast = useToast();
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId || !buttonRef.current) return;

    let cancelled = false;

    const handleCredential = async (response) => {
      try {
        const res = await API.post("/patient/google-auth", { idToken: response.credential });
        if (res.data.needsPhone) {
          onNeedsPhone(res.data.signupToken, res.data.profile);
        } else {
          onLoggedIn(res.data);
        }
      } catch (err) {
        toast.error(err.response?.data?.message || "Google sign-in failed");
      }
    };

    const tryInit = () => {
      if (cancelled) return;
      if (!window.google?.accounts?.id) {
        setTimeout(tryInit, 200);
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: handleCredential,
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: "outline",
        size: "large",
        width: 400,
        text: "continue_with",
      });
    };

    tryInit();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  if (!clientId) return null;

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3 mb-5">
        <div className="h-px flex-1 bg-gray-200" />
        <span className="text-xs text-[#6B7280]">or</span>
        <div className="h-px flex-1 bg-gray-200" />
      </div>
      <div ref={buttonRef} className="flex justify-center" />
    </div>
  );
}

// Google never supplies a phone number, which appointments are looked up by,
// so new Google accounts get this one extra step.
function GooglePhoneStep({ profile, onSubmit, onCancel, loading, error }) {
  const [phone, setPhone] = useState("");

  return (
    <div className="space-y-4">
      <p className="text-sm text-[#6B7280]">
        Welcome, {profile?.name || "there"}. One last step - add a phone number to finish creating your account.
      </p>
      <Field id="google-phone" label="Phone" error={error}>
        <input
          id="google-phone"
          type="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoFocus
          autoComplete="tel"
          aria-invalid={!!error}
          className={fieldCls(error)}
          placeholder="10-digit mobile number"
        />
      </Field>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-12 px-5 rounded-full border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 active:scale-[0.98] transition duration-150"
        >
          Cancel
        </button>
        <motion.button
          type="button"
          onClick={() => onSubmit(phone)}
          disabled={loading}
          whileTap={reduceMotion ? {} : { scale: 0.98 }}
          className="flex-1 h-12 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none shadow-[0_8px_20px_-6px_rgba(37,99,235,0.6)]"
        >
          {loading ? "Creating account…" : "Finish sign up"}
        </motion.button>
      </div>
    </div>
  );
}

function PasswordToggle({ shown, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-700 transition-colors"
      aria-label={shown ? "Hide password" : "Show password"}
      tabIndex={-1}
    >
      {shown ? (
        <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 3l18 18M10.73 10.73a2 2 0 002.54 2.54M9.88 4.24A9.12 9.12 0 0112 4c5 0 9 4 10 8a11.8 11.8 0 01-2.05 4.09M6.61 6.61A11.8 11.8 0 002 12c1 4 5 8 10 8a9.12 9.12 0 004.12-.98" />
        </svg>
      ) : (
        <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      )}
    </button>
  );
}

function Field({ id, label, error, children }) {
  // A string label gets a real <label htmlFor>. A node label may contain its
  // own links (e.g. "Forgot password?"), and wrapping those in a <label> would
  // hand their clicks to the input instead.
  const isText = typeof label === "string";
  return (
    <div>
      {isText ? (
        <label htmlFor={id} className="block text-[13px] font-medium text-gray-700 mb-1.5">
          {label}
        </label>
      ) : (
        <div className="block text-[13px] font-medium text-gray-700 mb-1.5">{label}</div>
      )}
      {children}
      <AnimatePresence initial={false}>
        {error && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.15 }}
            className="mt-1.5 text-xs text-red-600"
          >
            {error}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}

const fieldCls = (hasError) =>
  `w-full h-11 px-3.5 rounded-lg border bg-white text-[15px] text-gray-900 placeholder:text-gray-400 outline-none transition duration-150 ${
    hasError
      ? "border-red-300 focus:border-red-400 focus:ring-4 focus:ring-red-500/10"
      : "border-gray-300 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
  }`;

// Both /patient-login and /patient-register render this component (see the
// thin wrappers PatientLogin.jsx / PatientRegister.jsx); the route only picks
// which tab starts active. Light-only - no `dark:` classes, since App.jsx
// renders this outside the Sidebar/Header shell and its theme toggle.
function PatientAuth({ initialTab = "login" }) {
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const reduceMotion = useReducedMotion();

  const [tab, setTab] = useState(initialTab);

  const redirectTarget = location.state?.from
    ? `${location.state.from.pathname}${location.state.from.search || ""}`
    : "/patient-dashboard";

  useEffect(() => {
    if (localStorage.getItem("patientToken")) {
      navigate(redirectTarget, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate]);

  // Keep the URL (and back button) in sync with the active tab, without
  // losing the redirect-back `state.from` a protected route may have set.
  const switchTab = (next) => {
    if (next === tab) return;
    setTab(next);
    setLoginErrors({});
    setRegisterErrors({});
    navigate(next === "login" ? "/patient-login" : "/patient-register", {
      replace: true,
      state: location.state,
    });
  };

  const [googleSignup, setGoogleSignup] = useState(null); // { signupToken, profile } | null
  const [googlePhoneLoading, setGooglePhoneLoading] = useState(false);
  const [googlePhoneError, setGooglePhoneError] = useState("");

  const finishGoogleLogin = (data) => {
    localStorage.setItem("patientToken", data.token);
    localStorage.setItem("patient", JSON.stringify(data.patient));
    navigate(redirectTarget, { replace: true });
  };

  const handleGoogleComplete = async (phone) => {
    setGooglePhoneError("");
    if (!/^[6-9]\d{9}$/.test(phone.trim())) {
      setGooglePhoneError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    try {
      setGooglePhoneLoading(true);
      const res = await API.post("/patient/google-complete", {
        signupToken: googleSignup.signupToken,
        phone: phone.trim(),
      });
      toast.success("Account created successfully.");
      finishGoogleLogin(res.data);
    } catch (err) {
      setGooglePhoneError(err.response?.data?.message || "Could not create account");
    } finally {
      setGooglePhoneLoading(false);
    }
  };

  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [loginErrors, setLoginErrors] = useState({});
  const [loginShowPw, setLoginShowPw] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);

  const handleLoginChange = (e) => {
    setLoginForm({ ...loginForm, [e.target.name]: e.target.value });
    if (loginErrors[e.target.name]) {
      setLoginErrors((prev) => ({ ...prev, [e.target.name]: "" }));
    }
  };

  const validateLogin = () => {
    const errs = {};
    if (!loginForm.email.trim()) errs.email = "Email is required.";
    if (!loginForm.password) errs.password = "Password is required.";
    return errs;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    const errs = validateLogin();
    if (Object.keys(errs).length > 0) {
      setLoginErrors(errs);
      return;
    }
    try {
      setLoginLoading(true);
      const res = await API.post("/patient/login", loginForm);
      localStorage.setItem("patientToken", res.data.token);
      localStorage.setItem("patient", JSON.stringify(res.data.patient));
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || "Login failed");
    } finally {
      setLoginLoading(false);
    }
  };

  const [registerForm, setRegisterForm] = useState({
    name: "",
    email: "",
    phone: "",
    password: "",
    confirmPassword: "",
  });
  const [registerErrors, setRegisterErrors] = useState({});
  const [registerShowPw, setRegisterShowPw] = useState(false);
  const [registerShowConfirmPw, setRegisterShowConfirmPw] = useState(false);
  const [registerLoading, setRegisterLoading] = useState(false);

  const handleRegisterChange = (e) => {
    setRegisterForm({ ...registerForm, [e.target.name]: e.target.value });
    if (registerErrors[e.target.name]) {
      setRegisterErrors((prev) => ({ ...prev, [e.target.name]: "" }));
    }
  };

  const validateRegister = () => {
    const errs = {};
    if (!registerForm.name.trim()) errs.name = "Name is required.";
    if (!registerForm.email.trim()) errs.email = "Email is required.";
    if (!registerForm.phone.trim()) errs.phone = "Phone number is required.";
    if (!registerForm.password || registerForm.password.length < 8) {
      errs.password = "Password must be at least 8 characters.";
    }
    if (registerForm.confirmPassword !== registerForm.password) {
      errs.confirmPassword = "Passwords do not match.";
    }
    return errs;
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    const errs = validateRegister();
    if (Object.keys(errs).length > 0) {
      setRegisterErrors(errs);
      return;
    }

    try {
      setRegisterLoading(true);
      const res = await API.post("/patient/register", registerForm);
      localStorage.setItem("patientToken", res.data.token);
      localStorage.setItem("patient", JSON.stringify(res.data.patient));
      toast.success("Account created successfully.");
      navigate(redirectTarget, { replace: true });
    } catch (err) {
      toast.error(err.response?.data?.message || "Registration failed");
    } finally {
      setRegisterLoading(false);
    }
  };

  // One key for both tab switches and the Google signup step, so all three
  // cross-fade through the same AnimatePresence.
  const panelKey = googleSignup ? "google-phone" : tab;

  return (
    <div className="relative min-h-[100dvh] flex items-center justify-center px-4 py-16 bg-[#F8FAFC] overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(600px circle at 15% 15%, rgba(37,99,235,0.06), transparent 55%), radial-gradient(600px circle at 85% 85%, rgba(22,163,74,0.05), transparent 55%)",
        }}
      />

      <div className="relative w-full max-w-[460px]">
        {/* BRANDING */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="text-center mb-6"
        >
          <Link to="/" className="inline-flex items-center gap-2 mb-6 group">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center transition-transform duration-200 group-hover:scale-105">
              <span className="text-white font-bold text-xs">MF</span>
            </div>
            <span className="text-lg font-semibold text-gray-900 tracking-tight">MediFlow</span>
          </Link>
          <h1 className="text-[32px] sm:text-[36px] leading-[1.1] font-bold text-[#111827] tracking-tight">
            {tab === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-sm text-[#6B7280] mt-2">
            {tab === "login"
              ? "Sign in to view appointments and records."
              : "Set up patient access in under a minute."}
          </p>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.05, ease: EASE }}
          className="flex items-center gap-2.5 rounded-2xl px-4 py-3 mb-5 bg-primary-50 border border-primary-100"
        >
          <ShieldCheck weight="fill" className="w-5 h-5 text-primary-600 shrink-0" />
          <p className="text-[13px] font-medium text-primary-800 leading-snug">
            Your records stay encrypted and visible only to you and your care team.
          </p>
        </motion.div>

        {/* AUTH CARD */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.1, ease: EASE }}
          className="bg-white rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] p-6 sm:p-8"
        >
          {!googleSignup && (
            <div
              role="tablist"
              aria-label="Sign in or create account"
              className="grid grid-cols-2 gap-1 p-1 mb-7 rounded-lg bg-gray-100"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "login"}
                onClick={() => switchTab("login")}
                className={`relative py-2 text-sm font-medium rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 ${
                  tab === "login" ? "text-gray-900" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                {tab === "login" && (
                  <motion.span
                    layoutId="patientAuthTabPill"
                    className="absolute inset-0 bg-white rounded-md shadow-sm"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 }}
                  />
                )}
                <span className="relative">Sign In</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "register"}
                onClick={() => switchTab("register")}
                className={`relative py-2 text-sm font-medium rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/50 ${
                  tab === "register" ? "text-gray-900" : "text-gray-600 hover:text-gray-800"
                }`}
              >
                {tab === "register" && (
                  <motion.span
                    layoutId="patientAuthTabPill"
                    className="absolute inset-0 bg-white rounded-md shadow-sm"
                    transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 34 }}
                  />
                )}
                <span className="relative">Create Account</span>
              </button>
            </div>
          )}

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panelKey}
              initial={reduceMotion ? false : { opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -10 }}
              transition={{ duration: 0.2, ease: EASE }}
            >
              {googleSignup ? (
                <GooglePhoneStep
                  profile={googleSignup.profile}
                  onSubmit={handleGoogleComplete}
                  onCancel={() => {
                    setGoogleSignup(null);
                    setGooglePhoneError("");
                  }}
                  loading={googlePhoneLoading}
                  error={googlePhoneError}
                />
              ) : tab === "login" ? (
                <form onSubmit={handleLogin} noValidate className="space-y-4">
                  <Field id="login-email" label="Email" error={loginErrors.email}>
                    <input
                      id="login-email"
                      type="email"
                      name="email"
                      value={loginForm.email}
                      onChange={handleLoginChange}
                      autoFocus
                      autoComplete="email"
                      aria-invalid={!!loginErrors.email}
                      className={fieldCls(loginErrors.email)}
                      placeholder="you@example.com"
                    />
                  </Field>

                  <Field
                id="login-password"
                label={
                  <span className="flex items-center justify-between">
                    Password
                    <Link to="/forgot-password" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                      Forgot password?
                    </Link>
                  </span>
                }
                error={loginErrors.password}
              >
                    <div className="relative">
                      <input
                        id="login-password"
                        type={loginShowPw ? "text" : "password"}
                        name="password"
                        value={loginForm.password}
                        onChange={handleLoginChange}
                        autoComplete="current-password"
                        aria-invalid={!!loginErrors.password}
                        className={`${fieldCls(loginErrors.password)} pr-11`}
                        placeholder="••••••••"
                      />
                      <PasswordToggle shown={loginShowPw} onClick={() => setLoginShowPw((s) => !s)} />
                    </div>
                  </Field>

                  <motion.button
                    type="submit"
                    disabled={loginLoading}
                    whileTap={reduceMotion ? {} : { scale: 0.98 }}
                    className="w-full h-12 mt-2 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-2 shadow-[0_8px_20px_-6px_rgba(37,99,235,0.6)]"
                  >
                    {loginLoading && (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    {loginLoading ? "Signing in…" : "Sign in"}
                  </motion.button>
                </form>
              ) : (
                <form onSubmit={handleRegister} noValidate className="space-y-4">
                  <Field id="reg-name" label="Full name" error={registerErrors.name}>
                    <input
                      id="reg-name"
                      type="text"
                      name="name"
                      value={registerForm.name}
                      onChange={handleRegisterChange}
                      autoFocus
                      autoComplete="name"
                      aria-invalid={!!registerErrors.name}
                      className={fieldCls(registerErrors.name)}
                      placeholder="Your full name"
                    />
                  </Field>

                  <Field id="reg-email" label="Email" error={registerErrors.email}>
                    <input
                      id="reg-email"
                      type="email"
                      name="email"
                      value={registerForm.email}
                      onChange={handleRegisterChange}
                      autoComplete="email"
                      aria-invalid={!!registerErrors.email}
                      className={fieldCls(registerErrors.email)}
                      placeholder="you@example.com"
                    />
                  </Field>

                  <Field id="reg-phone" label="Phone" error={registerErrors.phone}>
                    <input
                      id="reg-phone"
                      type="tel"
                      name="phone"
                      value={registerForm.phone}
                      onChange={handleRegisterChange}
                      autoComplete="tel"
                      aria-invalid={!!registerErrors.phone}
                      className={fieldCls(registerErrors.phone)}
                      placeholder="10-digit mobile number"
                    />
                    {!registerErrors.phone && (
                      <p className="mt-1.5 text-xs text-[#6B7280]">
                        Use the same number you booked appointments with to link your history.
                      </p>
                    )}
                  </Field>

                  <Field id="reg-password" label="Password" error={registerErrors.password}>
                    <div className="relative">
                      <input
                        id="reg-password"
                        type={registerShowPw ? "text" : "password"}
                        name="password"
                        value={registerForm.password}
                        onChange={handleRegisterChange}
                        autoComplete="new-password"
                        aria-invalid={!!registerErrors.password}
                        className={`${fieldCls(registerErrors.password)} pr-11`}
                        placeholder="At least 8 characters"
                      />
                      <PasswordToggle shown={registerShowPw} onClick={() => setRegisterShowPw((s) => !s)} />
                    </div>
                  </Field>

                  <Field id="reg-confirm-password" label="Confirm password" error={registerErrors.confirmPassword}>
                    <div className="relative">
                      <input
                        id="reg-confirm-password"
                        type={registerShowConfirmPw ? "text" : "password"}
                        name="confirmPassword"
                        value={registerForm.confirmPassword}
                        onChange={handleRegisterChange}
                        autoComplete="new-password"
                        aria-invalid={!!registerErrors.confirmPassword}
                        className={`${fieldCls(registerErrors.confirmPassword)} pr-11`}
                        placeholder="Re-enter password"
                      />
                      <PasswordToggle
                        shown={registerShowConfirmPw}
                        onClick={() => setRegisterShowConfirmPw((s) => !s)}
                      />
                    </div>
                  </Field>

                  <motion.button
                    type="submit"
                    disabled={registerLoading}
                    whileTap={reduceMotion ? {} : { scale: 0.98 }}
                    className="w-full h-12 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none flex items-center justify-center gap-2 shadow-[0_8px_20px_-6px_rgba(37,99,235,0.6)]"
                  >
                    {registerLoading && (
                      <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                    )}
                    {registerLoading ? "Creating account…" : "Create account"}
                  </motion.button>
                </form>
              )}

              {!googleSignup && (
                <GoogleAuthSection
                  onLoggedIn={finishGoogleLogin}
                  onNeedsPhone={(signupToken, profile) => setGoogleSignup({ signupToken, profile })}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </motion.div>

        {/* FOOTER */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.16 }}
          className="mt-6 flex items-center justify-center gap-1.5 text-xs text-[#6B7280]"
        >
          <span>Need help?</span>
          <button
            type="button"
            onClick={() => toast.info("Contact your clinic's front desk for account assistance.")}
            className="font-medium text-primary-600 hover:text-primary-700 transition-colors focus:outline-none focus-visible:underline"
          >
            Contact support
          </button>
        </motion.div>
      </div>
    </div>
  );
}

export default PatientAuth;
