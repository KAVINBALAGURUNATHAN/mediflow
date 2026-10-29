import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { Pill, Prescription, CalendarBlank, Clock, Info, CalendarPlus } from "@phosphor-icons/react";
import usePatientRecords from "../hooks/usePatientRecords";

const EASE = [0.16, 1, 0.3, 1];

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// `status` is a virtual on the Prescription model, derived from the longest
// course length - it is never null, but stays defensive for older payloads.
function statusBadgeClass(status) {
  return status === "Active" ? "badge-serving" : "badge-completed";
}

function MedicineRow({ medicine }) {
  return (
    <li className="flex items-start gap-3 py-3.5 first:pt-0 last:pb-0">
      <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
        <Pill weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900 dark:text-white">{medicine.name}</p>
        <p className="text-sm text-slate-500 dark:text-slate-500 mt-0.5">
          {medicine.dosage} · {medicine.frequency} · {medicine.durationDays}{" "}
          {medicine.durationDays === 1 ? "day" : "days"}
        </p>
        {medicine.instructions && (
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">{medicine.instructions}</p>
        )}
      </div>
    </li>
  );
}

function PatientPrescriptions() {
  const reduceMotion = useReducedMotion();
  const { records: prescriptions, extra: legacyPrescriptions, loading } =
    usePatientRecords("/patient/prescriptions", "prescriptions", "legacyPrescriptions");

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-9 w-64 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-80 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-52 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const activeCount = prescriptions.filter((p) => p.status === "Active").length;
  const totalCount = prescriptions.length + legacyPrescriptions.length;

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        <motion.header
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="mb-8"
        >
          <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
            Prescriptions
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            {totalCount === 0
              ? "Medicines prescribed to you during a consultation"
              : `${activeCount} active of ${totalCount} total`}
          </p>
        </motion.header>

        {/* Compact row rather than a full-height card - an empty page here
            should read as "nothing yet", not as a broken layout. */}
        {totalCount === 0 ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : 0.05 }}
            className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6 flex flex-col sm:flex-row sm:items-center gap-4"
          >
            <div className="w-11 h-11 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
              <Prescription weight="duotone" className="w-6 h-6 text-primary-600" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white">No prescriptions yet</p>
              <p className="text-sm text-slate-500 dark:text-slate-500 mt-0.5">
                Your doctor issues one during or after a consultation, and it appears here.
              </p>
            </div>
            <Link
              to="/doctors"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 shrink-0"
            >
              <CalendarPlus weight="bold" className="w-4 h-4" aria-hidden />
              Book appointment
            </Link>
          </motion.div>
        ) : (
          <div className="space-y-4">
            {prescriptions.map((p, i) => (
              <motion.article
                key={p._id}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : Math.min(i, 6) * 0.05 }}
                className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6"
              >
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
                      <span className="text-white font-bold">
                        {(p.doctorId?.name || "D").trim().charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {p.doctorId?.name || "Doctor"}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-500 truncate">
                        {p.doctorId?.specialization || "Consultation"}
                      </p>
                    </div>
                  </div>
                  <span className={statusBadgeClass(p.status)}>{p.status || "Completed"}</span>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 py-4 border-y border-slate-200 dark:border-surface-border">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1.5">
                      <CalendarBlank weight="duotone" className="w-3.5 h-3.5" aria-hidden />
                      Issued
                    </dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">
                      {formatDate(p.issuedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1.5">
                      <Clock weight="duotone" className="w-3.5 h-3.5" aria-hidden />
                      Medicines
                    </dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5 font-mono">
                      {p.medicines?.length || 0}
                    </dd>
                  </div>
                  {p.appointmentId?.bookingId && (
                    <div>
                      <dt className="text-xs text-slate-500 dark:text-slate-500">Booking</dt>
                      <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5 font-mono truncate">
                        {p.appointmentId.bookingId}
                      </dd>
                    </div>
                  )}
                </dl>

                <ul className="divide-y divide-slate-200 dark:divide-surface-border mt-4">
                  {(p.medicines || []).map((m, idx) => (
                    <MedicineRow key={`${m.name}-${idx}`} medicine={m} />
                  ))}
                </ul>

                {p.notes && (
                  <div className="flex items-start gap-2.5 mt-4 pt-4 border-t border-slate-200 dark:border-surface-border">
                    <Info weight="duotone" className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-sm text-slate-600 dark:text-slate-300">{p.notes}</p>
                  </div>
                )}
              </motion.article>
            ))}

            {/* Consultations completed before prescriptions were recorded as
                structured medicine lists. Rendered as the free text it was
                actually written as, rather than split into fields that were
                never captured. */}
            {legacyPrescriptions.map((p, i) => (
              <motion.article
                key={p._id}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{
                  duration: 0.3,
                  ease: EASE,
                  delay: reduceMotion
                    ? 0
                    : Math.min(prescriptions.length + i, 6) * 0.05,
                }}
                className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6"
              >
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <p className="font-semibold text-slate-900 dark:text-white">
                      {p.doctorId?.name ? `Dr. ${p.doctorId.name}` : "Consultation"}
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-500 mt-0.5">
                      {p.doctorId?.specialization}
                    </p>
                  </div>
                  <span className="badge-completed">Past record</span>
                </div>

                <dl className="grid grid-cols-2 gap-4 mt-4">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-500">Date</dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">
                      {formatDate(p.appointmentDate)}
                    </dd>
                  </div>
                  {p.bookingId && (
                    <div className="min-w-0">
                      <dt className="text-xs text-slate-500 dark:text-slate-500">Booking</dt>
                      <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5 font-mono truncate">
                        {p.bookingId}
                      </dd>
                    </div>
                  )}
                </dl>

                {p.diagnosis && (
                  <div className="mt-4 pt-4 border-t border-slate-200 dark:border-surface-border">
                    <p className="text-xs text-slate-500 dark:text-slate-500">Diagnosis</p>
                    <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">
                      {p.diagnosis}
                    </p>
                  </div>
                )}

                <div className="flex items-start gap-2.5 mt-4 pt-4 border-t border-slate-200 dark:border-surface-border">
                  <Pill weight="duotone" className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" aria-hidden />
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">
                    {p.prescription}
                  </p>
                </div>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PatientPrescriptions;
