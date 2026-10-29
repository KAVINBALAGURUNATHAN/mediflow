import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { FileText, CalendarBlank, ArrowRight, CalendarPlus } from "@phosphor-icons/react";
import usePatientData from "../hooks/usePatientData";
import MedicalRecordCard from "../components/MedicalRecordCard";

const EASE = [0.16, 1, 0.3, 1];

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function PatientMedicalReports() {
  const reduceMotion = useReducedMotion();
  const { appointments, loading, downloadReport } = usePatientData();

  const completed = appointments.filter((a) => a.status === "Completed");

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
                className="h-56 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

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
            Medical Reports
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            {completed.length === 0
              ? "Diagnosis, prescriptions, and notes from completed consultations"
              : `${completed.length} report${completed.length === 1 ? "" : "s"} from completed consultations`}
          </p>
        </motion.header>

        {/* Compact row rather than a full-height card - an empty page here
            should read as "nothing yet", not as a broken layout. */}
        {completed.length === 0 ? (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : 0.05 }}
            className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6 flex flex-col sm:flex-row sm:items-center gap-4"
          >
            <div className="w-11 h-11 rounded-xl bg-secondary-50 dark:bg-secondary-500/10 flex items-center justify-center shrink-0">
              <FileText weight="duotone" className="w-6 h-6 text-secondary-600" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white">No medical reports yet</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                A report appears here once a consultation is marked completed.
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
            {completed.map((appointment, i) => (
              <motion.article
                key={appointment._id}
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : Math.min(i, 6) * 0.05 }}
                className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 sm:p-6"
              >
                <div className="flex items-start justify-between gap-4 mb-5">
                  {/* Initials, not a photo - the Doctor model has no photo field. */}
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-11 h-11 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
                      <span className="text-white font-bold">
                        {(appointment.doctorId?.name || "D").trim().charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-900 dark:text-white truncate">
                        {appointment.doctorId?.name || "Doctor"}
                      </p>
                      <p className="text-sm text-slate-500 dark:text-slate-400 truncate">
                        {appointment.doctorId?.specialization || "Consultation"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0 text-sm text-slate-500 dark:text-slate-400">
                    <CalendarBlank weight="duotone" className="w-4 h-4" aria-hidden />
                    {formatDate(appointment.appointmentDate)}
                  </div>
                </div>

                <MedicalRecordCard appointment={appointment} onDownload={downloadReport} />

                <Link
                  to={`/appointment/${appointment._id}`}
                  className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold text-primary-600 hover:text-primary-700 group"
                >
                  View appointment
                  <ArrowRight
                    className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </Link>
              </motion.article>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default PatientMedicalReports;
