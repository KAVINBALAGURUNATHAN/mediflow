import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  Flask,
  TestTube,
  CalendarBlank,
  ArrowUp,
  ArrowDown,
  Minus,
  Hourglass,
  Info,
  CalendarPlus,
} from "@phosphor-icons/react";
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

const STATUS_BADGE = {
  Ordered: "badge-neutral",
  "In Progress": "badge-waiting",
  Completed: "badge-completed",
};

// Normal reads as reassuring green; High and Low are both out-of-range and
// share the same amber treatment, differing only by direction - neither is
// shown in danger red, since an out-of-range reading is for the doctor to
// interpret and colouring it as an alarm would overstate it.
const FLAG_STYLE = {
  Normal: {
    Icon: Minus,
    className:
      "bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-400",
  },
  High: {
    Icon: ArrowUp,
    className:
      "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  },
  Low: {
    Icon: ArrowDown,
    className:
      "bg-warning-100 text-warning-700 dark:bg-warning-500/15 dark:text-warning-400",
  },
};

function ValueRow({ item }) {
  const { Icon, className } = FLAG_STYLE[item.flag] || FLAG_STYLE.Normal;

  return (
    <li className="flex items-center gap-3 py-3.5 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <p className="font-medium text-slate-900 dark:text-white truncate">{item.parameter}</p>
        {item.referenceRange && (
          <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">
            Reference {item.referenceRange}
            {item.unit ? ` ${item.unit}` : ""}
          </p>
        )}
      </div>
      <p className="text-sm font-semibold text-slate-900 dark:text-white font-mono shrink-0 text-right">
        {item.value}
        {item.unit && <span className="text-slate-500 dark:text-slate-500 font-normal"> {item.unit}</span>}
      </p>
      <span
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 w-[86px] justify-center ${className}`}
      >
        <Icon weight="bold" className="w-3 h-3" aria-hidden />
        {item.flag || "Normal"}
      </span>
    </li>
  );
}

function PatientLabResults() {
  const reduceMotion = useReducedMotion();
  const { records: labResults, loading } = usePatientRecords("/patient/lab-results", "labResults");

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-9 w-56 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-80 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-56 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const pending = labResults.filter((r) => r.status !== "Completed").length;

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
            Lab Results
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            {labResults.length === 0
              ? "Tests ordered by your doctor and their results"
              : `${labResults.length} test${labResults.length === 1 ? "" : "s"}${
                  pending ? ` · ${pending} awaiting results` : ""
                }`}
          </p>
        </motion.header>

        {labResults.length === 0 ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : 0.05 }}
            className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6 flex flex-col sm:flex-row sm:items-center gap-4"
          >
            <div className="w-11 h-11 rounded-xl bg-secondary-50 dark:bg-secondary-500/10 flex items-center justify-center shrink-0">
              <Flask weight="duotone" className="w-6 h-6 text-secondary-600" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white">No lab results yet</p>
              <p className="text-sm text-slate-500 dark:text-slate-500 mt-0.5">
                Tests ordered during a consultation appear here as soon as the lab reports back.
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
            {labResults.map((r, i) => (
              <motion.article
                key={r._id}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : Math.min(i, 6) * 0.05 }}
                className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6"
              >
                <div className="flex items-start justify-between gap-4 mb-5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-secondary-50 dark:bg-secondary-500/10 flex items-center justify-center shrink-0">
                      <TestTube weight="duotone" className="w-6 h-6 text-secondary-600" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">{r.testName}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-500 truncate">
                        Ordered by {r.doctorId?.name || "your doctor"}
                        {r.doctorId?.specialization ? ` · ${r.doctorId.specialization}` : ""}
                      </p>
                    </div>
                  </div>
                  <span className={STATUS_BADGE[r.status] || "badge-neutral"}>{r.status}</span>
                </div>

                <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 py-4 border-y border-slate-200 dark:border-surface-border">
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1.5">
                      <CalendarBlank weight="duotone" className="w-3.5 h-3.5" aria-hidden />
                      Ordered
                    </dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">
                      {formatDate(r.orderedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1.5">
                      <Hourglass weight="duotone" className="w-3.5 h-3.5" aria-hidden />
                      Resulted
                    </dt>
                    <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">
                      {r.resultedAt ? formatDate(r.resultedAt) : "Pending"}
                    </dd>
                  </div>
                  {r.appointmentId?.bookingId && (
                    <div>
                      <dt className="text-xs text-slate-500 dark:text-slate-500">Booking</dt>
                      <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5 font-mono truncate">
                        {r.appointmentId.bookingId}
                      </dd>
                    </div>
                  )}
                </dl>

                {/* The backend withholds values until a result is finalised
                    (see sanitizeLabResultForPatient), so an empty list here
                    genuinely means "not reported yet", not "all normal". */}
                {r.values?.length > 0 ? (
                  <ul className="divide-y divide-slate-200 dark:divide-surface-border mt-4">
                    {r.values.map((v, idx) => (
                      <ValueRow key={`${v.parameter}-${idx}`} item={v} />
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-500 mt-4">
                    Results are not available yet. They appear here once the lab reports back.
                  </p>
                )}

                {r.summary && (
                  <div className="flex items-start gap-2.5 mt-4 pt-4 border-t border-slate-200 dark:border-surface-border">
                    <Info weight="duotone" className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-sm text-slate-600 dark:text-slate-300">{r.summary}</p>
                  </div>
                )}
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PatientLabResults;
