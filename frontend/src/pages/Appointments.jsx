import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { CalendarBlank, MagnifyingGlass, XCircle } from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import { getStatusBadgeClass } from "../utils/statusBadge";
import useFirstMountThisSession from "../hooks/useFirstMountThisSession";

const EASE = [0.16, 1, 0.3, 1];

const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

function Appointments() {
  const toast = useToast();
  const shouldAnimate = useFirstMountThisSession("appointments-page");
  const reduceMotion = useReducedMotion();
  const animate = shouldAnimate && !reduceMotion;

  const rise = (i = 0) =>
    animate
      ? {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, ease: EASE, delay: i * 0.06 },
        }
      : {};

  // Read the latest toast through a ref instead of putting `toast` in the
  // fetchAppointments dependency array. If the ToastContext provider ever
  // passes a new object reference on re-render (e.g. its value isn't
  // wrapped in useMemo upstream), including `toast` directly in deps would
  // recreate fetchAppointments -> retrigger the effect below -> refetch
  // and potentially re-toast the same error every time an unrelated
  // ancestor re-renders.
  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState("");
  const [searchTerm, setSearchTerm] = useState("");

  const fetchAppointments = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (status) params.append("status", status);

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

  const handleRetry = () => {
    const controller = new AbortController();
    fetchAppointments(controller.signal);
  };

  useEffect(() => {
    const controller = new AbortController();
    fetchAppointments(controller.signal);
    return () => controller.abort();
  }, [fetchAppointments]);

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

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-[1400px] mx-auto">
          <div className="h-10 w-64 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-40 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className={`h-[76px] ${CARD} animate-pulse mb-6`} />
          <div className={`h-[520px] ${CARD} animate-pulse`} />
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
                Could not load appointments
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
              Appointments
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              {filteredAppointments.length} record{filteredAppointments.length === 1 ? "" : "s"} across
              every date.
            </p>
          </div>
        </motion.header>

        {/* TOOLBAR */}
        <motion.div {...rise(1)} className={`${CARD} p-4 mb-6`}>
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

        {filteredAppointments.length === 0 ? (
          <motion.div {...rise(2)} className={`${CARD} p-5`}>
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                <CalendarBlank weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-slate-900 dark:text-white">No appointments found</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Try clearing the search box or choosing a different status.
                </p>
              </div>
              {(searchTerm || status) && (
                <button
                  onClick={() => {
                    setSearchTerm("");
                    setStatus("");
                  }}
                  className="shrink-0 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150"
                >
                  Clear filters
                </button>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.section {...rise(2)} className={CARD}>
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto rounded-2xl">
              <table className="w-full min-w-[760px]">
                <thead className="sticky top-0 z-10 bg-white dark:bg-surface-card">
                  <tr>
                    {["Patient", "Date", "Slot", "Status"].map((h) => (
                      <th
                        key={h}
                        scope="col"
                        className="text-left text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 px-6 py-3.5 border-b border-slate-200 dark:border-surface-border whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                    <th
                      scope="col"
                      className="text-right text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 px-6 py-3.5 border-b border-slate-200 dark:border-surface-border whitespace-nowrap"
                    >
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredAppointments.map((appt) => (
                    <tr
                      key={appt._id}
                      className="hover:bg-slate-50 dark:hover:bg-white/[0.03] transition duration-150"
                    >
                      <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border text-sm font-semibold text-slate-900 dark:text-white">
                        {appt.patientName}
                      </td>
                      <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border text-sm text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {new Date(appt.appointmentDate).toLocaleDateString("en-IN", {
                          day: "2-digit",
                          month: "short",
                          year: "numeric",
                        })}
                      </td>
                      <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border text-sm text-slate-600 dark:text-slate-300">
                        {appt.slot}
                      </td>
                      <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border">
                        <span className={getStatusBadgeClass(appt.status)}>{appt.status}</span>
                      </td>
                      <td className="px-6 py-3.5 border-b border-slate-100 dark:border-surface-border whitespace-nowrap">
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
                            className="inline-flex items-center h-9 px-3.5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150"
                          >
                            Details
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </motion.section>
        )}
      </div>
    </div>
  );
}

export default Appointments;
