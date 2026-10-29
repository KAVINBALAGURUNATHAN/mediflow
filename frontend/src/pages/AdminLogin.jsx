import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ShieldCheck, ArrowLeft, LockKey } from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";

const EASE = [0.16, 1, 0.3, 1];

// Rendered outside the Sidebar/Header shell (see isPublicPatientPage in
// App.jsx). Keep in sync with DoctorLogin.jsx and ReceptionistLogin.jsx.
function AdminLogin() {
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    if (localStorage.getItem("adminToken")) {
      navigate("/admin-dashboard", { replace: true });
    }
  }, [navigate]);

  const [form, setForm] = useState({ email: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const res = await API.post("/admin/login", form);
      localStorage.setItem("adminToken", res.data.token);
      localStorage.setItem("admin", JSON.stringify(res.data.admin));
      toast.success("Welcome back, Admin.", { title: "Login Successful" });
      navigate("/admin-dashboard");
    } catch (err) {
      toast.error(err.response?.data?.message || "Login failed. Check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = () => {
    toast.info("Password resets are handled by your system administrator.");
  };

  const reduceMotion = useReducedMotion();

  return (
    <div className="min-h-[100dvh] w-full bg-[#F8FAFC] lg:grid lg:grid-cols-[46%_54%]">
      {/* BRAND PANEL — lg and up only */}
      <aside className="relative hidden lg:flex lg:flex-col lg:justify-between overflow-hidden bg-slate-900 px-12 xl:px-16 py-14">
        <img
          src="/images/care-team.jpg"
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div aria-hidden="true" className="absolute inset-0 bg-slate-900/85" />

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="relative flex items-center gap-3"
        >
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
            <ShieldCheck weight="duotone" className="w-5 h-5 text-white" />
          </div>
          <div className="leading-tight">
            <p className="text-[15px] font-semibold text-white tracking-tight">MediFlow</p>
            <p className="text-xs text-white/70">Staff Portal</p>
          </div>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08, ease: EASE }}
          className="relative max-w-md"
        >
          <h2 className="text-[34px] xl:text-[40px] leading-[1.12] font-bold text-white tracking-tight">
            The hospital,
            <br />
            end to end.
          </h2>
          <p className="mt-4 text-[15px] leading-relaxed text-white/75">
            Sign in to manage doctors, staff accounts and departments, and to review how every
            MediFlow branch is running today.
          </p>
        </motion.div>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.16, ease: EASE }}
          className="relative max-w-md space-y-5"
        >
          <div className="flex gap-3 rounded-2xl bg-white/10 ring-1 ring-white/20 p-4">
            <LockKey weight="duotone" className="w-5 h-5 shrink-0 text-white mt-0.5" />
            <p className="text-[13px] leading-relaxed text-white/85">
              Access is restricted to authorised administrators. Activity on this portal is
              logged. If you do not have credentials, contact your system administrator.
            </p>
          </div>

          <button
            type="button"
            onClick={() => navigate("/")}
            className="inline-flex items-center gap-2 text-[13px] font-medium text-white hover:text-white/80 transition-colors rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <ArrowLeft weight="bold" className="w-4 h-4" />
            Back to MediFlow website
          </button>
        </motion.div>
      </aside>

      {/* FORM COLUMN */}
      <main className="relative flex min-h-[100dvh] flex-col px-5 sm:px-8 lg:px-12 xl:px-20">
        <div className="mx-auto flex w-full max-w-[26rem] flex-1 flex-col justify-center py-12 sm:py-16">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            <div className="lg:hidden flex items-center gap-3 mb-8">
              <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
                <ShieldCheck weight="duotone" className="w-5 h-5 text-white" />
              </div>
              <div className="leading-tight">
                <p className="text-[15px] font-semibold text-[#111827] tracking-tight">
                  MediFlow
                </p>
                <p className="text-xs text-[#6B7280]">Staff Portal</p>
              </div>
            </div>

            <h1 className="text-[28px] sm:text-[32px] font-bold text-[#111827] tracking-tight">
              Admin Login
            </h1>
            <p className="text-sm text-[#6B7280] mt-2">
              Sign in to manage hospital operations.
            </p>
          </motion.div>

          {/* LOGIN CARD */}
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.08, ease: EASE }}
            className="mt-7 bg-white rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] p-6 sm:p-8"
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label htmlFor="email" className="block text-[13px] font-medium text-gray-700 mb-1.5">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  required
                  autoFocus
                  className="w-full h-11 px-3.5 rounded-lg border border-gray-300 bg-white text-[15px] text-gray-900 placeholder:text-gray-400 outline-none transition duration-150 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
                  placeholder="admin@hospital.com"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" className="block text-[13px] font-medium text-gray-700">
                    Password
                  </label>
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs font-medium text-primary-600 hover:text-primary-700"
                  >
                    Forgot password?
                  </button>
                </div>

                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    name="password"
                    value={form.password}
                    onChange={handleChange}
                    required
                    className="w-full h-11 px-3.5 pr-11 rounded-lg border border-gray-300 bg-white text-[15px] text-gray-900 placeholder:text-gray-400 outline-none transition duration-150 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1.5 text-gray-500 hover:text-gray-700 transition-colors"
                    aria-label={showPassword ? "Hide password" : "Show password"}
                  >
                    {showPassword ? (
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
                </div>
              </div>

              <motion.button
                type="submit"
                disabled={loading}
                whileTap={reduceMotion ? undefined : { scale: 0.98 }}
                className="w-full h-12 mt-2 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none shadow-[0_8px_20px_-6px_rgba(37,99,235,0.6)]"
              >
                {loading ? "Signing in…" : "Sign in"}
              </motion.button>
            </form>

            <div className="mt-6 pt-4 border-t border-gray-100">
              <p className="text-xs text-center text-gray-500">
                Authorized administrators only.
              </p>
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, delay: 0.16 }}
            className="mt-6"
          >
            <p className="text-xs font-medium text-[#6B7280]">
              Contact your system administrator for credentials.
            </p>

            <button
              type="button"
              onClick={() => navigate("/")}
              className="lg:hidden mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-primary-600 hover:text-primary-700 transition-colors"
            >
              <ArrowLeft weight="bold" className="w-3.5 h-3.5" />
              Back to MediFlow website
            </button>
          </motion.div>
        </div>

        {/* FOOTER — pinned to the bottom of the form column */}
        <motion.div
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.24 }}
          className="mx-auto w-full max-w-[26rem] pb-8 pt-2"
        >
          <div className="border-t border-slate-200 pt-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1">
            <p className="text-[11px] text-gray-500">MediFlow Admin Portal · v1.0.0</p>
            <p className="text-[11px] text-gray-500">
              © {new Date().getFullYear()} MediFlow
            </p>
          </div>
        </motion.div>
      </main>
    </div>
  );
}

export default AdminLogin;
