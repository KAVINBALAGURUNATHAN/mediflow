import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  CalendarBlank,
  Clock,
  Pulse,
  CheckCircle,
  XCircle,
  MagnifyingGlass,
  Play,
  UserCircle,
  Stethoscope,
  ArrowRight,
  ListChecks,
} from "@phosphor-icons/react";
import API from "../api/api";
import { liveQueueAPI, settingsAPI } from "../services/api";
import useSocket from "../hooks/useSocket";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "../components/ConfirmModal";
import { getStatusBadgeClass } from "../utils/statusBadge";
import useFirstMountThisSession from "../hooks/useFirstMountThisSession";

const EASE = [0.16, 1, 0.3, 1];
const QUICK_MINUTES = [5, 10, 15, 20, 30];

// Card shell shared by every panel on this page - one border, one radius,
// one shadow, matching PatientDashboard/Analytics.
const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

function StatCard({ label, value, caption, Icon, tone }) {
  return (
    <div className={`${CARD} p-5`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${tone}`}>
        <Icon weight="duotone" className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-[28px] leading-none font-bold text-slate-900 dark:text-white font-mono">
        {value ?? 0}
      </p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">{label}</p>
      <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">{caption}</p>
    </div>
  );
}

// Compact horizontal empty state - icon + text on a single row, never a
// large blank box.
function EmptyPanel({ Icon, title, text }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-surface-border p-4">
      <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-surface flex items-center justify-center shrink-0">
        <Icon weight="duotone" className="w-5 h-5 text-slate-500" aria-hidden />
      </div>
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900 dark:text-white">{title}</p>
        {text && <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">{text}</p>}
      </div>
    </div>
  );
}

// An Appointment defaults to status "Waiting" the moment it's booked, even
// before the patient has checked in - tokenNumber is only assigned at
// check-in (see PATCH /appointments/:id/check-in). Without this
// distinction, a freshly-booked appointment looks identical to one that's
// actually checked in and sitting in the live queue, which is confusing
// since only the latter shows up in Live Queue / Next Patient.
function getDisplayStatus(appt) {
  if (appt.status === "Waiting" && (appt.tokenNumber === null || appt.tokenNumber === undefined)) {
    return { label: "Booked", cls: "badge-booked" };
  }
  return { label: appt.status, cls: getStatusBadgeClass(appt.status) };
}

function DoctorDashboard() {
  const toast = useToast();
  const navigate = useNavigate();
  const shouldAnimate = useFirstMountThisSession("doctor-dashboard");
  const reduceMotion = useReducedMotion();
  const animate = shouldAnimate && !reduceMotion;

  const rise = (i = 0) =>
    animate
      ? {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, ease: EASE, delay: i * 0.04 },
        }
      : {};

  // Read the latest toast through a ref instead of putting `toast` in the
  // fetchAppointments dependency array. If the ToastContext provider ever
  // passes a new object reference on re-render (e.g. its value isn't
  // wrapped in useMemo upstream), including `toast` directly in deps would
  // recreate fetchAppointments -> retrigger the effect below -> refetch
  // and potentially re-toast the same error every time an unrelated
  // ancestor re-renders (e.g. App.js's socket `isConnected` state).
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const [stats, setStats] = useState(null);
  const [queue, setQueue] = useState([]);
  const [nextPatient, setNextPatient] = useState(null);
  const [avgTime, setAvgTime] = useState(0);
  const [actionLoadingId, setActionLoadingId] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  const [customMinutes, setCustomMinutes] = useState("");
  const [savingMinutes, setSavingMinutes] = useState(false);

  const fetchAppointments = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (status) params.append("status", status);
        // This section is titled "Today's Appointments" - scope it to
        // actually match, rather than every appointment the doctor has
        // ever had (past or future).
        params.append("date", new Date().toISOString().split("T")[0]);

        const queryString = params.toString() ? `?${params.toString()}` : "";
        const res = await API.get(`/appointments/my${queryString}`, {
          signal,
        });
        setAppointments(res.data.appointments || []);
      } catch (err) {
        if (
          err.name === "CanceledError" ||
          err.name === "AbortError" ||
          err.code === "ERR_CANCELED"
        ) {
          return;
        }

        const msg = err.response?.data?.message || "Failed to fetch appointments";
        setError(msg);
        toastRef.current?.error(msg);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    // Only `status` should cause a refetch. `toast` is intentionally
    // excluded — see toastRef above.
    [status]
  );

  const fetchStats = useCallback(async (signal) => {
    try {
      const res = await API.get("/doctor/dashboard/stats", { signal });
      setStats(res.data.stats);
    } catch (err) {
      if (
        err.name === "CanceledError" ||
        err.name === "AbortError" ||
        err.code === "ERR_CANCELED"
      ) {
        return;
      }
      toastRef.current?.error(err.response?.data?.message || "Failed to load stats");
    }
  }, []);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await liveQueueAPI.getAll();
      setQueue(Array.isArray(res.data) ? res.data : []);
    } catch (err) {
      // services/api.js normalizes errors to plain Error(message), so
      // err.response is never populated here - unlike the `API` instance
      // above (src/api/api.js), which has no response interceptor.
      toastRef.current?.error(err.message || "Failed to load live queue");
    }
  }, []);

  const fetchNextPatient = useCallback(async () => {
    try {
      const res = await liveQueueAPI.getNextPatient();
      setNextPatient(res.data.patient);
    } catch (err) {
      // Backend returns 404 with this exact message when there are no
      // waiting patients - that's an expected empty state, not an error.
      // (services/api.js's interceptor strips err.response, so this has to
      // be matched on message rather than status code.)
      if (err.message === "No waiting patients found today") {
        setNextPatient(null);
        return;
      }
      toastRef.current?.error(err.message || "Failed to load next patient");
    }
  }, []);

  // "Today's Appointments" above is deliberately scoped with ?date=today.
  // For the upcoming schedule, fetch with no date filter at all (this is
  // the exact same /appointments/my endpoint, just without that param, so
  // it naturally returns every appointment - past, today, and future) and
  // keep only the future ones client-side. No new backend endpoint needed.
  const fetchUpcoming = useCallback(async (signal) => {
    try {
      const res = await API.get("/appointments/my", { signal });
      const all = res.data.appointments || [];
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const future = all
        .filter((a) => new Date(a.appointmentDate) >= startOfToday && new Date(a.appointmentDate).toDateString() !== new Date().toDateString())
        .sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate));

      setUpcoming(future);
    } catch (err) {
      if (err.name === "CanceledError" || err.name === "AbortError" || err.code === "ERR_CANCELED") {
        return;
      }
      // Non-critical section - fail quietly rather than toast-spam on top
      // of the main appointments/stats fetches.
    } finally {
      if (!signal?.aborted) setUpcomingLoading(false);
    }
  }, []);

  const fetchConsultationTime = useCallback(async () => {
    try {
      const res = await settingsAPI.getTime();
      if (res.data?.averageConsultationTime !== undefined) {
        setAvgTime(res.data.averageConsultationTime);
      }
    } catch {
      // Non-critical - dashboard still works without this.
    }
  }, []);

  const handleRetry = () => {
    const controller = new AbortController();
    fetchAppointments(controller.signal);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchAppointments(controller.signal);
    return () => controller.abort();
  }, [fetchAppointments]);

  useEffect(() => {
    const controller = new AbortController();
    fetchStats(controller.signal);
    fetchQueue();
    fetchNextPatient();
    fetchConsultationTime();
    fetchUpcoming(controller.signal);
    return () => controller.abort();
  }, [fetchStats, fetchQueue, fetchNextPatient, fetchConsultationTime, fetchUpcoming]);

  const handleQueueUpdated = useCallback(() => {
    fetchQueue();
    fetchNextPatient();
    fetchStats();
    fetchAppointments();
  }, [fetchQueue, fetchNextPatient, fetchStats, fetchAppointments]);

  useSocket("queueUpdated", handleQueueUpdated);

  const filteredAppointments = useMemo(() => {
    const searchLower = searchTerm.trim().toLowerCase();

    return appointments
      .filter((app) => {
        return (
          app.patientName?.toLowerCase().includes(searchLower) ||
          app.slot?.toLowerCase().includes(searchLower) ||
          app.status?.toLowerCase().includes(searchLower)
        );
      })
      .sort((a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate));
  }, [appointments, searchTerm]);

  const currentPatient = useMemo(
    () => queue.find((p) => p.status === "In Consultation") || null,
    [queue]
  );

  const waitingQueue = useMemo(
    () => queue.filter((p) => p.status === "Waiting" || p.status === "In Consultation"),
    [queue]
  );

  const groupedUpcoming = useMemo(() => {
    const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toDateString();
    const groups = new Map();

    upcoming.forEach((appt) => {
      const d = new Date(appt.appointmentDate);
      const key =
        d.toDateString() === tomorrowStr
          ? "Tomorrow"
          : d.toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "short" });

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(appt);
    });

    return Array.from(groups.entries());
  }, [upcoming]);

  const queuePosition = useMemo(() => {
    if (!nextPatient) return 0;
    const idx = queue
      .filter((p) => p.status === "Waiting")
      .findIndex((p) => p._id === nextPatient._id);
    return idx >= 0 ? idx + 1 : 0;
  }, [queue, nextPatient]);

  const handleSetEstimatedDuration = async (minutes) => {
    if (!currentPatient) return;
    try {
      await liveQueueAPI.setEstimatedDuration(currentPatient._id, minutes);
      toast.success(`Estimated ${minutes} min set`);
      fetchQueue();
    } catch (err) {
      toast.error(err.message || "Failed to set estimated time");
    }
  };

  // Same guard rails the shared CurrentTokenCard applied: 1-180 minutes,
  // and the control is disabled while the PATCH is in flight.
  const submitMinutes = async (minutes) => {
    if (!currentPatient || !minutes || minutes < 1 || minutes > 180) return;
    setSavingMinutes(true);
    try {
      await handleSetEstimatedDuration(minutes);
      setCustomMinutes("");
    } finally {
      setSavingMinutes(false);
    }
  };

  const handleStartConsultation = async (appointmentId) => {
    setActionLoadingId(appointmentId);
    try {
      await liveQueueAPI.startConsultation(appointmentId);
      toast.success("Consultation started");
      fetchQueue();
      fetchNextPatient();
      fetchStats();
      fetchAppointments();
    } catch (err) {
      toast.error(err.message || "Failed to start consultation");
    } finally {
      setActionLoadingId(null);
    }
  };

  // Completing a consultation requires a diagnosis and a prescription - the
  // backend refuses "Completed" without both, so no patient ends up with a
  // finished visit and an empty medical record. Sending just the status from
  // here always failed with "Diagnosis is required" and left the doctor to
  // find somewhere to type it, so go straight to the appointment page, which
  // already has those fields and the Complete action on it.
  const handleCompleteConsultation = (appointmentId) => {
    navigate(`/appointments/${appointmentId}`);
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-[1400px] mx-auto">
          <div className="h-10 w-72 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-96 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-5 mb-6">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className={`h-36 ${CARD} animate-pulse`} />
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-6">
            <div className={`xl:col-span-8 h-56 ${CARD} animate-pulse`} />
            <div className={`xl:col-span-4 h-56 ${CARD} animate-pulse`} />
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-8 space-y-6">
              <div className={`h-16 ${CARD} animate-pulse`} />
              <div className={`h-80 ${CARD} animate-pulse`} />
            </div>
            <div className="xl:col-span-4 space-y-6">
              <div className={`h-64 ${CARD} animate-pulse`} />
              <div className={`h-64 ${CARD} animate-pulse`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (error)
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-[1400px] mx-auto">
          <div className={`${CARD} p-6 flex flex-col sm:flex-row sm:items-center gap-4`}>
            <div className="w-11 h-11 rounded-xl bg-danger-50 dark:bg-danger-500/10 flex items-center justify-center shrink-0">
              <XCircle weight="duotone" className="w-5 h-5 text-danger-600" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-slate-900 dark:text-white">
                Could not load the dashboard
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{error}</p>
            </div>
            <button
              onClick={handleRetry}
              className="h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 shrink-0"
            >
              Try again
            </button>
          </div>
        </div>
      </div>
    );

  const currentToken = Number(currentPatient?.tokenNumber) || 0;
  const currentName = currentPatient?.patientName || currentPatient?.name || "";
  const estimated = currentPatient?.estimatedDurationMinutes;
  const remainingMinutes =
    estimated && currentPatient?.consultationStartedAt
      ? Math.max(
          0,
          Math.round(
            estimated - (Date.now() - new Date(currentPatient.consultationStartedAt).getTime()) / 60000
          )
        )
      : null;

  const statCards = [
    {
      label: "Today's appointments",
      value: stats?.todayAppointments,
      caption: "Scheduled for today",
      Icon: CalendarBlank,
      tone: "bg-primary-50 text-primary-600 dark:bg-primary-500/10",
    },
    {
      label: "Waiting",
      value: stats?.waiting,
      caption: avgTime > 0 ? `Avg consultation ${avgTime} min` : "Checked in, awaiting you",
      Icon: Clock,
      tone: "bg-warning-50 text-warning-600 dark:bg-warning-500/10",
    },
    {
      label: "In consultation",
      value: stats?.inConsultation,
      caption: currentPatient ? "Currently with you" : "Nobody in the room",
      Icon: Pulse,
      tone: "bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10",
    },
    {
      label: "Completed",
      value: stats?.completed,
      caption: "Consultations finished today",
      Icon: CheckCircle,
      tone: "bg-success-50 text-success-600 dark:bg-success-500/10",
    },
    {
      label: "Cancelled",
      value: stats?.cancelled,
      caption: "Cancelled today",
      Icon: XCircle,
      tone: "bg-danger-50 text-danger-600 dark:bg-danger-500/10",
    },
  ];

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-[1400px] mx-auto">
        {/* HEADER */}
        <motion.header
          {...rise(0)}
          className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8"
        >
          <div>
            <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em] mb-2">
              Doctor Portal
            </p>
            <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
              Doctor Dashboard
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "2-digit", month: "long", year: "numeric" })}
            </p>
          </div>
          <Link
            to="/appointments"
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 shrink-0"
          >
            <ListChecks weight="bold" className="w-4 h-4" aria-hidden />
            All appointments
          </Link>
        </motion.header>

        {/* STATS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-5 mb-6">
          {statCards.map((s, i) => (
            <motion.div key={s.label} {...rise(1 + i)}>
              <StatCard {...s} />
            </motion.div>
          ))}
        </div>

        {/* NOW SERVING + NEXT PATIENT */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 mb-6">
          <motion.section {...rise(6)} className={`xl:col-span-8 ${CARD} p-6`} aria-label="Now serving">
            <div className="flex items-center justify-between gap-3 mb-5">
              <div className="flex items-center gap-2.5">
                <span className="live-dot" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Now serving</h2>
              </div>
              {currentPatient && (
                <span className="badge-serving">In Consultation</span>
              )}
            </div>

            {!currentPatient ? (
              <EmptyPanel
                Icon={Stethoscope}
                title="No consultation in progress"
                text="Call in the next patient from the queue on the right. Once a consultation starts you can set how long it should take, which sharpens the wait time every waiting patient sees."
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-5 rounded-2xl border border-slate-200 dark:border-surface-border p-5">
                  <div className="min-w-0">
                    <p className="text-xs text-slate-500 dark:text-slate-500 uppercase tracking-wider font-semibold">
                      Token
                    </p>
                    <p
                      className="text-[56px] leading-none font-bold font-mono text-primary-600 dark:text-primary-400 mt-1"
                      aria-live="polite"
                    >
                      {currentToken > 0 ? String(currentToken).padStart(2, "0") : "—"}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1 sm:border-l sm:border-slate-200 sm:dark:border-surface-border sm:pl-5">
                    <p className="text-xs text-slate-500 dark:text-slate-500 uppercase tracking-wider font-semibold">
                      Patient
                    </p>
                    <p
                      className="text-xl font-semibold text-slate-900 dark:text-white truncate mt-1"
                      title={currentName || "In Consultation"}
                    >
                      {currentName || "In Consultation"}
                    </p>
                    {(estimated || remainingMinutes !== null) && (
                      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
                        {estimated ? `Estimated ${estimated} min` : null}
                        {remainingMinutes !== null && (
                          <span className="ml-1">· ~{remainingMinutes} min remaining</span>
                        )}
                      </p>
                    )}
                  </div>
                </div>

                <div className="mt-5 pt-5 border-t border-slate-200 dark:border-surface-border">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-500 uppercase tracking-wider mb-2.5">
                    Set estimated time
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {QUICK_MINUTES.map((m) => (
                      <button
                        key={m}
                        type="button"
                        onClick={() => submitMinutes(m)}
                        disabled={savingMinutes}
                        className="h-9 px-3.5 rounded-full text-sm font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-surface-border hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150 disabled:opacity-50"
                      >
                        {m}m
                      </button>
                    ))}
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        min={1}
                        max={180}
                        value={customMinutes}
                        onChange={(e) => setCustomMinutes(e.target.value)}
                        placeholder="Custom"
                        aria-label="Custom estimated minutes"
                        className="w-24 h-9 px-3 text-sm rounded-full bg-white dark:bg-surface text-slate-900 dark:text-white border border-slate-200 dark:border-surface-border outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
                      />
                      <button
                        type="button"
                        onClick={() => submitMinutes(Number(customMinutes))}
                        disabled={savingMinutes || !customMinutes}
                        className="h-9 px-4 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        Set
                      </button>
                    </div>
                  </div>
                </div>
              </>
            )}
          </motion.section>

          {/* NEXT PATIENT */}
          <motion.section {...rise(7)} className={`xl:col-span-4 ${CARD} p-6`}>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">Next patient</h2>
            {nextPatient ? (
              <div className="rounded-2xl border border-slate-200 dark:border-surface-border p-5">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
                    <span className="text-white font-bold font-mono">
                      {String(nextPatient.tokenNumber).padStart(2, "0")}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">
                      {nextPatient.patientName}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                      Slot {nextPatient.slot}
                      {queuePosition > 0 && <span> · Position {queuePosition}</span>}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleStartConsultation(nextPatient._id)}
                  disabled={!!currentPatient || actionLoadingId === nextPatient._id}
                  className="w-full inline-flex items-center justify-center gap-2 h-11 px-5 mt-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Play weight="fill" className="w-4 h-4" aria-hidden />
                  {actionLoadingId === nextPatient._id ? "Starting…" : "Start consultation"}
                </button>
                {!!currentPatient && (
                  <p className="text-xs text-slate-500 dark:text-slate-500 mt-2.5 text-center">
                    Complete the current consultation first.
                  </p>
                )}
              </div>
            ) : (
              <EmptyPanel
                Icon={UserCircle}
                title="No waiting patients"
                text="Patients appear here once they check in."
              />
            )}
          </motion.section>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* TODAY'S APPOINTMENTS */}
          <div className="xl:col-span-8 space-y-6">
            <motion.div {...rise(8)} className={`${CARD} p-4`}>
              <div className="flex flex-col sm:flex-row gap-3">
                <div className="relative flex-1">
                  <MagnifyingGlass
                    className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500"
                    aria-hidden
                  />
                  <input
                    aria-label="Search appointments"
                    type="text"
                    placeholder="Search by patient, slot, or status…"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full h-11 pl-10 pr-4 text-sm rounded-full bg-white dark:bg-surface text-slate-900 dark:text-white border border-slate-200 dark:border-surface-border outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition duration-150"
                  />
                </div>
                <select
                  aria-label="Filter by status"
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="h-11 px-4 sm:w-52 text-sm rounded-full bg-white dark:bg-surface text-slate-900 dark:text-white border border-slate-200 dark:border-surface-border outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition duration-150"
                >
                  <option value="">All status</option>
                  <option value="Waiting">Waiting</option>
                  <option value="In Consultation">In Consultation</option>
                  <option value="Completed">Completed</option>
                  <option value="Cancelled">Cancelled</option>
                </select>
              </div>
            </motion.div>

            <motion.section {...rise(9)} className={CARD}>
              <div className="flex items-center justify-between gap-3 p-6 pb-4">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                  Today&apos;s appointments
                </h2>
                <span className="text-sm text-slate-500 dark:text-slate-400 font-mono">
                  {filteredAppointments.length}
                </span>
              </div>
              {filteredAppointments.length === 0 ? (
                <div className="px-6 pb-6">
                  <EmptyPanel
                    Icon={CalendarBlank}
                    title="No appointments found"
                    text="Nothing matches the current search or filter."
                  />
                </div>
              ) : (
                <div className="max-h-[28rem] overflow-y-auto border-t border-slate-200 dark:border-surface-border">
                  <table className="w-full">
                    <thead className="sticky top-0 z-10 bg-white dark:bg-surface-card">
                      <tr>
                        {["Patient", "Slot", "Status"].map((h) => (
                          <th
                            key={h}
                            scope="col"
                            className="text-left text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 px-6 py-3 border-b border-slate-200 dark:border-surface-border whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="text-right text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 px-6 py-3 border-b border-slate-200 dark:border-surface-border whitespace-nowrap"
                        >
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredAppointments.map((appt) => {
                        const displayStatus = getDisplayStatus(appt);
                        return (
                          <tr
                            key={appt._id}
                            className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition duration-150"
                          >
                            <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border">
                              <Link
                                to={`/appointments/${appt._id}`}
                                className="text-sm font-semibold text-slate-900 dark:text-white hover:text-primary-600"
                              >
                                {appt.patientName}
                              </Link>
                            </td>
                            <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border text-sm text-slate-600 dark:text-slate-300">
                              {appt.slot}
                            </td>
                            <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border">
                              <span className={displayStatus.cls}>{displayStatus.label}</span>
                            </td>
                            <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border">
                              <div className="flex items-center justify-end gap-2">
                                {appt.phone && (
                                  <Link
                                    to={`/patient-history/${appt.phone}`}
                                    className="inline-flex items-center h-9 px-3.5 rounded-full text-sm font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-surface-border hover:bg-slate-50 dark:hover:bg-surface transition duration-150"
                                  >
                                    History
                                  </Link>
                                )}
                                <Link
                                  to={`/appointments/${appt._id}`}
                                  className="inline-flex items-center h-9 px-3.5 rounded-full text-sm font-semibold text-primary-700 dark:text-primary-300 bg-primary-50 dark:bg-primary-500/10 hover:bg-primary-100 dark:hover:bg-primary-500/20 transition duration-150"
                                >
                                  View
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.section>
          </div>

          {/* SIDE COLUMN */}
          <aside className="xl:col-span-4 space-y-6">
            {/* LIVE QUEUE */}
            <motion.section {...rise(10)} className={CARD}>
              <div className="flex items-center justify-between gap-3 p-6 pb-4">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Live queue</h2>
                {avgTime > 0 && (
                  <span className="text-xs text-slate-500 dark:text-slate-400">Avg {avgTime} min</span>
                )}
              </div>
              {waitingQueue.length === 0 ? (
                <div className="px-6 pb-6">
                  <EmptyPanel Icon={Pulse} title="Queue is empty" text="No patients checked in yet." />
                </div>
              ) : (
                <ul className="max-h-80 overflow-y-auto border-t border-slate-200 dark:border-surface-border">
                  {waitingQueue.map((p) => (
                    <li
                      key={p._id}
                      className="flex items-center justify-between gap-3 px-6 py-3.5 border-b border-slate-100 dark:border-surface-border last:border-b-0 hover:bg-slate-50 dark:hover:bg-white/[0.03] transition duration-150"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="w-9 h-9 rounded-xl bg-slate-100 dark:bg-surface flex items-center justify-center shrink-0 text-xs font-bold font-mono text-slate-700 dark:text-slate-200">
                          {String(p.tokenNumber).padStart(2, "0")}
                        </span>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                            {p.patientName || p.name}
                          </p>
                          <span className={getStatusBadgeClass(p.status)}>{p.status}</span>
                        </div>
                      </div>
                      {p.status === "In Consultation" && (
                        <button
                          onClick={() => handleCompleteConsultation(p._id)}
                          title="Record diagnosis and prescription, then complete"
                          className="shrink-0 inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full text-sm font-semibold text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-surface-border hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150"
                        >
                          Complete
                          <ArrowRight weight="bold" className="w-3.5 h-3.5" aria-hidden />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </motion.section>

            {/* UPCOMING SCHEDULE */}
            <motion.section {...rise(11)} className={CARD}>
              <div className="flex items-center justify-between gap-3 p-6 pb-4">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Upcoming schedule</h2>
                <ArrowRight className="w-4 h-4 text-slate-500" aria-hidden />
              </div>
              {upcomingLoading ? (
                <div className="px-6 pb-6 space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-12 rounded-xl bg-slate-100 dark:bg-surface animate-pulse" />
                  ))}
                </div>
              ) : groupedUpcoming.length === 0 ? (
                <div className="px-6 pb-6">
                  <EmptyPanel
                    Icon={CalendarBlank}
                    title="Nothing scheduled ahead"
                    text="Future appointments will show up here."
                  />
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto border-t border-slate-200 dark:border-surface-border">
                  {groupedUpcoming.map(([dateLabel, appts]) => (
                    <div key={dateLabel} className="px-6 py-4 border-b border-slate-100 dark:border-surface-border last:border-b-0">
                      <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.07em] mb-2.5">
                        {dateLabel}
                      </p>
                      <ul className="space-y-2">
                        {appts.map((appt) => (
                          <li key={appt._id} className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-slate-900 dark:text-white truncate">
                                {appt.patientName}
                              </p>
                              <p className="text-xs text-slate-500 dark:text-slate-400">{appt.slot}</p>
                            </div>
                            <span className={getStatusBadgeClass(appt.status)}>{appt.status}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </motion.section>
          </aside>
        </div>
      </div>

      <ConfirmModal config={confirmModal} onClose={() => setConfirmModal(null)} />
    </div>
  );
}

export default DoctorDashboard;
