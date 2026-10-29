import { useParams, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  CalendarBlank,
  Clock,
  Hash,
  Stethoscope,
  NotePencil,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import usePatientData from "../hooks/usePatientData";
import MedicalRecordCard from "../components/MedicalRecordCard";
import { getStatusBadgeClass } from "../utils/statusBadge";

const EASE = [0.16, 1, 0.3, 1];

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function DetailTile({ label, value, Icon, tone, mono }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-surface-border p-4">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${tone}`}>
        <Icon weight="duotone" className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p
        className={`text-sm font-semibold text-slate-900 dark:text-white mt-1 ${mono ? "font-mono" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

// There is no single "GET one appointment" endpoint scoped to the
// authenticated patient in the backend (only the doctor-auth one, and the
// full list one this app already uses) - finding it client-side in the
// already-fetched list avoids adding a new backend route, which is out of
// scope for this auth/navigation-only change.
function PatientAppointmentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { appointments, loading, downloadReport } = usePatientData();

  const appointment = appointments.find((a) => a._id === id);

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-9 w-72 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-48 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="h-72 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] animate-pulse mb-4" />
          <div className="h-48 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] animate-pulse" />
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-warning-50 dark:bg-warning-500/10 flex items-center justify-center shrink-0">
              <MagnifyingGlass weight="duotone" className="w-6 h-6 text-warning-600" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white">Appointment not found</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                This appointment is not in your history, or the link is out of date.
              </p>
            </div>
            <button
              type="button"
              onClick={() => navigate("/my-appointments")}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 shrink-0"
            >
              <ArrowLeft weight="bold" className="w-4 h-4" aria-hidden />
              My appointments
            </button>
          </div>
        </div>
      </div>
    );
  }

  const tiles = [
    {
      label: "Specialization",
      value: appointment.doctorId?.specialization || "Consultation",
      Icon: Stethoscope,
      tone: "bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10",
    },
    {
      label: "Date",
      value: formatDate(appointment.appointmentDate),
      Icon: CalendarBlank,
      tone: "bg-primary-50 text-primary-600 dark:bg-primary-500/10",
    },
    {
      label: "Time slot",
      value: appointment.slot || "—",
      Icon: Clock,
      tone: "bg-warning-50 text-warning-600 dark:bg-warning-500/10",
    },
    {
      label: "Queue token",
      value:
        appointment.tokenNumber !== null && appointment.tokenNumber !== undefined
          ? String(appointment.tokenNumber).padStart(2, "0")
          : "Not checked in",
      Icon: Hash,
      tone: "bg-success-50 text-success-600 dark:bg-success-500/10",
      mono: appointment.tokenNumber !== null && appointment.tokenNumber !== undefined,
    },
  ];

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        <motion.header
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="mb-8"
        >
          <button
            type="button"
            onClick={() => navigate("/my-appointments")}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors duration-150 mb-4 group"
          >
            <ArrowLeft
              weight="bold"
              className="w-4 h-4 transition-transform duration-200 group-hover:-translate-x-0.5"
              aria-hidden
            />
            Back to my appointments
          </button>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
                Appointment details
              </h1>
              <p className="text-slate-500 dark:text-slate-400 mt-2 font-mono">
                {appointment.bookingId}
              </p>
            </div>
            <span className={`${getStatusBadgeClass(appointment.status)} shrink-0 self-start sm:self-auto`}>
              {appointment.status}
            </span>
          </div>
        </motion.header>

        <motion.section
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : 0.05 }}
          className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 sm:p-6 mb-4"
        >
          {/* Initials, not a photo - the Doctor model has no photo field. */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
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

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {tiles.map((t) => (
              <DetailTile key={t.label} {...t} />
            ))}
          </div>

          {appointment.symptoms && (
            <div className="flex items-start gap-2.5 mt-5 pt-5 border-t border-slate-200 dark:border-surface-border">
              <NotePencil weight="duotone" className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-slate-500 dark:text-slate-400">Symptoms you reported</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 mt-0.5">{appointment.symptoms}</p>
              </div>
            </div>
          )}
        </motion.section>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : 0.1 }}
        >
          <MedicalRecordCard appointment={appointment} onDownload={downloadReport} />
        </motion.div>
      </div>
    </div>
  );
}

export default PatientAppointmentDetail;
