import { Link } from "react-router-dom";
import { ArrowRight, UsersThree } from "@phosphor-icons/react";
import { getStatusBadgeClass } from "../utils/statusBadge";
import MedicalRecordCard from "./MedicalRecordCard";

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

// Reused by My Appointments (full history), the Dashboard's previews, and
// implicitly mirrors the detail shown on the single Appointment page - one
// card layout for every list that shows an appointment summary.
function PatientAppointmentCard({ appointment, showMedicalRecord = false, onDownload, linkToDetail = true }) {
  const content = (
    <>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
            <span className="text-white font-bold">
              {(appointment.doctorId?.name || "D").trim().charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
              {appointment.doctorId?.name || "Doctor"}
            </h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 truncate">
              {appointment.doctorId?.specialization || "Consultation"}
            </p>
          </div>
        </div>
        <span className={`self-start ${getStatusBadgeClass(appointment.status)}`}>
          {appointment.status}
        </span>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mt-5 py-4 border-y border-slate-200 dark:border-surface-border">
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Date</dt>
          <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">
            {formatDate(appointment.appointmentDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Time Slot</dt>
          <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">
            {appointment.slot || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-slate-500 dark:text-slate-400">Queue Token</dt>
          <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5 font-mono">
            {appointment.tokenNumber !== null && appointment.tokenNumber !== undefined
              ? String(appointment.tokenNumber).padStart(2, "0")
              : "Not checked in"}
          </dd>
        </div>
      </dl>

      {showMedicalRecord && (
        <div className="mt-4">
          <MedicalRecordCard appointment={appointment} onDownload={onDownload} />
        </div>
      )}

      {/* Live queue position. Only meaningful once reception has checked the
          patient in and issued a token, and pointless once the visit is over -
          the waiting-room route needs doctorId and tokenNumber together,
          since tokens are unique per doctor per day rather than clinic-wide. */}
      {appointment.tokenNumber !== null &&
        appointment.tokenNumber !== undefined &&
        appointment.status !== "Completed" &&
        appointment.status !== "Cancelled" && (
          <div className="mt-4">
            <Link
              to={`/waiting-room/${appointment.doctorId?._id || appointment.doctorId}/${appointment.tokenNumber}`}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150"
            >
              <UsersThree weight="duotone" className="w-4 h-4" aria-hidden />
              View queue position
            </Link>
          </div>
        )}

      {linkToDetail && (
        <div className="mt-4 text-right">
          <Link
            to={`/appointment/${appointment._id}`}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 group"
          >
            View Details
            <ArrowRight
              className="w-4 h-4 transition duration-200 group-hover:translate-x-0.5"
              aria-hidden
            />
          </Link>
        </div>
      )}
    </>
  );

  return (
    <div className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] animate-slide-up">
      {content}
    </div>
  );
}

export default PatientAppointmentCard;
