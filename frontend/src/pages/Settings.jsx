import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  House,
  UserCircle,
  CalendarBlank,
  ChartBar,
  PencilSimple,
  SignOut,
  Envelope,
  CaretRight,
} from "@phosphor-icons/react";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "../components/ConfirmModal";
import useFirstMountThisSession from "../hooks/useFirstMountThisSession";

const EASE = [0.16, 1, 0.3, 1];

const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

function Settings() {
  const navigate = useNavigate();
  const toast = useToast();
  const [doctor, setDoctor] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const shouldAnimate = useFirstMountThisSession("settings-page");
  const reduceMotion = useReducedMotion();
  const animate = shouldAnimate && !reduceMotion;

  const rise = (i = 0) =>
    animate
      ? {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, ease: EASE, delay: i * 0.05 },
        }
      : {};

  useEffect(() => {
    try {
      const storedDoctor = JSON.parse(localStorage.getItem("doctor"));

      if (!storedDoctor) {
        navigate("/doctor-login");
        return;
      }

      setDoctor(storedDoctor);
    } catch {
      localStorage.removeItem("doctorToken");
      localStorage.removeItem("doctor");
      navigate("/doctor-login");
    }
  }, [navigate]);

  const logout = () => {
    setConfirmModal({
      title: "Log out?",
      message: "You will be signed out of the Doctor portal.",
      variant: "warning",
      confirmLabel: "Log out",
      onConfirm: () => {
        // Only this role's session - other roles/patients logged in on the
        // same browser must not be logged out as a side effect (see the
        // matching fix in Sidebar.jsx's handleLogout).
        localStorage.removeItem("doctorToken");
        localStorage.removeItem("doctor");
        toast.info("You have been logged out.");
        navigate("/doctor-login", { replace: true });
      },
    });
  };

  if (!doctor) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-10 w-52 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-72 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className={`lg:col-span-1 h-56 ${CARD} animate-pulse`} />
            <div className="lg:col-span-2 space-y-6">
              <div className={`h-56 ${CARD} animate-pulse`} />
              <div className={`h-44 ${CARD} animate-pulse`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const quickLinks = [
    {
      title: "Dashboard",
      caption: "Live queue and today's list",
      Icon: House,
      path: "/dashboard",
      tone: "bg-primary-50 text-primary-600 dark:bg-primary-500/10",
    },
    {
      title: "Doctor Profile",
      caption: "Hours, fee and leave",
      Icon: UserCircle,
      path: "/doctor/profile",
      tone: "bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10",
    },
    {
      title: "Appointments",
      caption: "Every booking, all dates",
      Icon: CalendarBlank,
      path: "/appointments",
      tone: "bg-warning-50 text-warning-600 dark:bg-warning-500/10",
    },
    {
      title: "Analytics",
      caption: "Volumes and completion rates",
      Icon: ChartBar,
      path: "/analytics",
      tone: "bg-success-50 text-success-600 dark:bg-success-500/10",
    },
  ];

  // The Doctor model has no photo field - initials only.
  const initials = (doctor.name || "D")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        {/* HEADER */}
        <motion.header {...rise(0)} className="mb-8">
          <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em] mb-2">
            Doctor Portal
          </p>
          <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
            Settings
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Manage your account and jump to the rest of the portal.
          </p>
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ACCOUNT */}
          <motion.aside {...rise(1)} className={`lg:col-span-1 ${CARD} p-6 h-fit`}>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
                <span className="text-white text-xl font-bold">{initials}</span>
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                  {doctor.name}
                </h2>
                <span className="inline-flex items-center px-2.5 py-0.5 mt-1 rounded-full text-xs font-semibold bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                  {doctor.specialization || "Doctor"}
                </span>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-surface flex items-center justify-center shrink-0">
                <Envelope weight="duotone" className="w-5 h-5 text-slate-500" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400">Email</p>
                <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                  {doctor.email}
                </p>
              </div>
            </div>
          </motion.aside>

          {/* RIGHT */}
          <div className="lg:col-span-2 space-y-6">
            <motion.section {...rise(2)} className={`${CARD} p-6`}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">
                Quick navigation
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {quickLinks.map(({ title, caption, Icon, path, tone }) => (
                  <button
                    key={title}
                    onClick={() => navigate(path)}
                    className="group flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-surface-border p-4 text-left hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150"
                  >
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
                      <Icon weight="duotone" className="w-5 h-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 dark:text-white group-hover:text-primary-600 dark:group-hover:text-primary-400 transition duration-150">
                        {title}
                      </p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{caption}</p>
                    </div>
                    <CaretRight
                      weight="bold"
                      className="w-4 h-4 text-slate-500 shrink-0 transition duration-150 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </button>
                ))}
              </div>
            </motion.section>

            <motion.section {...rise(3)} className={`${CARD} p-6`}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">
                Account actions
              </h2>

              <div className="flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => navigate("/doctor/profile")}
                  className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-slate-200 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150"
                >
                  <PencilSimple weight="duotone" className="w-4 h-4" aria-hidden />
                  Edit profile
                </button>

                <button
                  onClick={logout}
                  className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-danger-500 text-white text-sm font-semibold hover:bg-danger-600 active:scale-[0.98] transition duration-150"
                >
                  <SignOut weight="bold" className="w-4 h-4" aria-hidden />
                  Log out
                </button>
              </div>
            </motion.section>

            <motion.p {...rise(4)} className="text-center text-sm text-slate-500 dark:text-slate-400">
              MediFlow Doctor Portal • Version 1.0
            </motion.p>
          </div>
        </div>
      </div>

      <ConfirmModal config={confirmModal} onClose={() => setConfirmModal(null)} />
    </div>
  );
}

export default Settings;
