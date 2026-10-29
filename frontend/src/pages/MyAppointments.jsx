import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarBlank, CheckCircle, XCircle, CalendarPlus, Eye, EyeSlash } from "@phosphor-icons/react";
import usePatientData from "../hooks/usePatientData";
import PatientAppointmentCard from "../components/PatientAppointmentCard";
import AppointmentActions from "../components/AppointmentActions";

// Now a protected, authenticated page (see PatientProtectedRoute in App.jsx) -
// it used to be a public phone-number lookup form. Since a logged-in
// patient's identity is already known from their JWT, there's nothing left
// to look up; this just lists their own appointment history directly.
function MyAppointments() {
  const { appointments, loading, downloadReport, reload } = usePatientData();

  // Cancelled appointments are hidden by default: after cancelling or
  // rescheduling, the dead entry sitting alongside the live one read as "the
  // old appointment is still booked". They stay reachable behind the toggle
  // rather than being dropped, since a patient may still want the record.
  const [showCancelled, setShowCancelled] = useState(false);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const cancelledCount = appointments.filter((a) => a.status === "Cancelled").length;

  const visibleAppointments = showCancelled
    ? appointments
    : appointments.filter((a) => a.status !== "Cancelled");

  const stats = [
    {
      label: "Upcoming",
      Icon: CalendarBlank,
      tone: "text-primary-600 bg-primary-50 dark:bg-primary-500/10",
      value: appointments.filter(
        (a) =>
          a.status !== "Cancelled" &&
          a.status !== "Completed" &&
          new Date(a.appointmentDate) >= today
      ).length,
    },
    {
      label: "Completed",
      Icon: CheckCircle,
      tone: "text-success-600 bg-success-50 dark:bg-success-500/10",
      value: appointments.filter((a) => a.status === "Completed").length,
    },
    {
      label: "Cancelled",
      Icon: XCircle,
      tone: "text-danger-600 bg-danger-50 dark:bg-danger-500/10",
      value: cancelledCount,
    },
  ];

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        <div className="mb-6 animate-slide-up">
          <h1 className="page-heading mb-2">My Appointments</h1>
          <p className="page-subheading">Your full appointment history</p>
        </div>

        {!loading && (
          <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-8 animate-slide-up">
            {stats.map(({ label, value, Icon, tone }) => (
              <div key={label} className="card p-4 sm:p-5 rounded-2xl">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${tone}`}>
                  <Icon weight="duotone" className="w-5 h-5" aria-hidden />
                </div>
                <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono leading-none">
                  {value}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-500 mt-1.5">{label}</p>
              </div>
            ))}
          </div>
        )}

        {loading && (
          <div className="text-center py-12">
            <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-slate-600 dark:text-slate-500">Loading appointments...</p>
          </div>
        )}

        {/* Compact empty state - a full-height card here read as a broken
            page rather than an intentional "nothing yet" state. */}
        {!loading && cancelledCount > 0 && (
          <div className="flex justify-end mb-4">
            <button
              type="button"
              onClick={() => setShowCancelled((value) => !value)}
              className="inline-flex items-center gap-2 h-9 px-4 rounded-full text-sm font-medium text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition duration-150"
            >
              {showCancelled ? (
                <EyeSlash weight="bold" className="w-4 h-4" aria-hidden />
              ) : (
                <Eye weight="bold" className="w-4 h-4" aria-hidden />
              )}
              {showCancelled ? "Hide" : "Show"} cancelled ({cancelledCount})
            </button>
          </div>
        )}

        {!loading && visibleAppointments.length === 0 && (
          <div className="card p-6 rounded-2xl flex flex-col sm:flex-row sm:items-center gap-4 animate-slide-up">
            <div className="w-11 h-11 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
              <CalendarBlank weight="duotone" className="w-6 h-6 text-primary-600" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white">No appointments scheduled</p>
              <p className="text-sm text-slate-500 dark:text-slate-500 mt-0.5">
                Start by booking a consultation with one of our specialists.
              </p>
            </div>
            <Link
              to="/doctors"
              className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 shrink-0"
            >
              <CalendarPlus weight="bold" className="w-4 h-4" aria-hidden />
              Book appointment
            </Link>
          </div>
        )}

        {!loading && visibleAppointments.length > 0 && (
          <div className="space-y-4">
            {visibleAppointments.map((appointment) => (
              <div key={appointment._id}>
                <PatientAppointmentCard
                  appointment={appointment}
                  showMedicalRecord={appointment.status === "Completed"}
                  onDownload={downloadReport}
                />
                <AppointmentActions appointment={appointment} onChanged={reload} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default MyAppointments;
