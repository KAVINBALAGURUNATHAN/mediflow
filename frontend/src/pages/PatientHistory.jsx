import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  ClipboardText,
  Pill,
  NotePencil,
  FirstAidKit,
  XCircle,
  Stethoscope,
} from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import { getStatusBadgeClass } from "../utils/statusBadge";

const EASE = [0.16, 1, 0.3, 1];

const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

// Helper moved outside to prevent recreation on render
const getStatusBadge = (status) => (
  <span className={getStatusBadgeClass(status)}>{status || "N/A"}</span>
);

function Block({ label, Icon, tone, children }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-surface-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${tone}`}>
          <Icon weight="duotone" className="w-4 h-4" aria-hidden />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500">{label}</p>
      </div>
      <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-line">
        {children}
      </p>
    </div>
  );
}

function PatientHistory() {
  const { phone } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const reduceMotion = useReducedMotion();

  const rise = (i = 0) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, ease: EASE, delay: Math.min(i, 6) * 0.05 },
        };

  // Read the latest toast through a ref instead of putting `toast` in the
  // fetchHistory dependency array. Same recurring issue found in
  // DoctorDashboard.jsx, Appointments.jsx, and Doctors.jsx — if the
  // ToastContext provider's value isn't memoized upstream, `toast`'s
  // reference changing on unrelated re-renders would recreate
  // fetchHistory and retrigger the fetch effect below.
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [history, setHistory] = useState([]);
  const [patientName, setPatientName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchHistory = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        // /patients/history/:phone doesn't exist on the backend. The real
        // equivalent is /appointments/patient/:phone, which returns every
        // visit for this phone number across all doctors, each with
        // doctorId populated (name, specialization) - see server.js.
        const res = await API.get(`/appointments/patient/${phone}`, { signal });
        const appointments = res.data.appointments || [];
        setHistory(appointments);
        setPatientName(appointments[0]?.patientName || "Unknown Patient");
      } catch (err) {
        if (
          err.name === "CanceledError" ||
          err.name === "AbortError" ||
          err.code === "ERR_CANCELED"
        ) {
          return;
        }

        const msg =
          err.response?.data?.message || "Failed to load patient history.";
        setError(msg);
        toastRef.current?.error(msg);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    // `toast` intentionally excluded — see toastRef above.
    [phone]
  );

  const handleRetry = () => {
    const controller = new AbortController();
    fetchHistory(controller.signal);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchHistory(controller.signal);
    return () => controller.abort();
  }, [fetchHistory]);

  const sortedHistory = useMemo(() => {
    return [...history].sort(
      (a, b) => new Date(b.appointmentDate) - new Date(a.appointmentDate)
    );
  }, [history]);

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-10 w-64 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-56 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="space-y-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={`h-64 ${CARD} animate-pulse`} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error)
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className={`${CARD} p-6 flex flex-col sm:flex-row sm:items-center gap-4`}>
            <div className="w-11 h-11 rounded-xl bg-danger-50 dark:bg-danger-500/10 flex items-center justify-center shrink-0">
              <XCircle weight="duotone" className="w-5 h-5 text-danger-600" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-slate-900 dark:text-white">
                Could not load patient history
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

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        <motion.div {...rise(0)}>
          <button
            onClick={() => navigate(-1)}
            className="inline-flex items-center gap-2 h-9 px-3.5 -ml-1 mb-5 rounded-full text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-surface transition duration-150"
          >
            <ArrowLeft weight="bold" className="w-4 h-4" aria-hidden />
            Back
          </button>
        </motion.div>

        {/* HEADER */}
        <motion.header
          {...rise(1)}
          className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em] mb-2">
              Patient file
            </p>
            <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white truncate">
              {patientName}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2 font-mono">{phone}</p>
          </div>
          <div className={`${CARD} p-5 shrink-0 sm:min-w-[180px]`}>
            <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 flex items-center justify-center mb-4">
              <ClipboardText weight="duotone" className="w-5 h-5" aria-hidden />
            </div>
            <p className="text-[28px] leading-none font-bold font-mono text-slate-900 dark:text-white">
              {history.length}
            </p>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">Total visits</p>
            <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">Across all doctors</p>
          </div>
        </motion.header>

        <div className="space-y-6">
          {sortedHistory.length === 0 ? (
            <motion.div {...rise(2)} className={`${CARD} p-5`}>
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-surface flex items-center justify-center shrink-0">
                  <Stethoscope weight="duotone" className="w-5 h-5 text-slate-500" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="font-medium text-slate-900 dark:text-white">No medical history yet</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    Records appear here once a consultation is completed.
                  </p>
                </div>
              </div>
            </motion.div>
          ) : (
            sortedHistory.map((visit, index) => {
              const dateVal = visit.appointmentDate;
              const appointmentDate =
                dateVal && !Number.isNaN(new Date(dateVal).getTime())
                  ? new Date(dateVal)
                  : null;

              return (
                <motion.article key={visit._id} {...rise(2 + index)} className={`${CARD} p-6`}>
                  <div className="flex items-start justify-between gap-4 mb-5">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.07em] mb-1">
                        {appointmentDate
                          ? appointmentDate.toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "Unknown Date"}
                      </p>
                      <h2 className="font-semibold text-slate-900 dark:text-white truncate">
                        Consultation with {visit.doctorId?.name || "Dr. Assigned"}
                      </h2>
                      {visit.completedAt && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          Completed {new Date(visit.completedAt).toLocaleString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </p>
                      )}
                    </div>
                    {getStatusBadge(visit.status)}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <Block
                      label="Symptoms"
                      Icon={FirstAidKit}
                      tone="bg-warning-50 text-warning-600 dark:bg-warning-500/10"
                    >
                      {visit.symptoms || "—"}
                    </Block>
                    <Block
                      label="Diagnosis"
                      Icon={Stethoscope}
                      tone="bg-primary-50 text-primary-600 dark:bg-primary-500/10"
                    >
                      {visit.diagnosis || "—"}
                    </Block>
                    <div className="sm:col-span-2">
                      <Block
                        label="Prescription"
                        Icon={Pill}
                        tone="bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10"
                      >
                        {visit.prescription || "—"}
                      </Block>
                    </div>
                    {visit.notes && (
                      <div className="sm:col-span-2">
                        <Block
                          label="Notes"
                          Icon={NotePencil}
                          tone="bg-slate-100 text-slate-600 dark:bg-surface dark:text-slate-300"
                        >
                          {visit.notes}
                        </Block>
                      </div>
                    )}
                  </div>
                </motion.article>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default PatientHistory;
