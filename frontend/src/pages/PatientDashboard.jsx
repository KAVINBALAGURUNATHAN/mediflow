import { Link } from "react-router-dom";
import {
  CalendarBlank,
  CheckCircle,
  FileText,
  Heartbeat,
  CalendarPlus,
  Ambulance,
  Phone,
  Clock,
  ArrowRight,
  Drop,
  User,
  ShieldPlus,
} from "@phosphor-icons/react";
import usePatientData from "../hooks/usePatientData";
import { useBranch } from "../context/BranchContext";
import { getStatusBadgeClass } from "../utils/statusBadge";

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function ageFrom(dob) {
  if (!dob) return null;
  const d = new Date(dob);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function StatCard({ label, value, caption, Icon, tone }) {
  return (
    <div className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.14)] transition-shadow duration-200">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${tone}`}>
        <Icon weight="duotone" className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-[28px] leading-none font-bold text-slate-900 dark:text-white font-mono">{value}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">{label}</p>
      <p className="text-xs text-slate-500 dark:text-slate-500 mt-0.5">{caption}</p>
    </div>
  );
}

function Panel({ title, action, children }) {
  return (
    <section className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function PatientDashboard() {
  const { patient, appointments, loading } = usePatientData();
  const { branch } = useBranch();

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-[1400px] mx-auto">
          <div className="h-10 w-72 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-96 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-36 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-8 space-y-6">
              <div className="h-56 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl animate-pulse" />
              <div className="h-64 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl animate-pulse" />
            </div>
            <div className="xl:col-span-4 space-y-6">
              <div className="h-52 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl animate-pulse" />
              <div className="h-52 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl animate-pulse" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingAll = appointments
    .filter((a) => a.status !== "Cancelled" && a.status !== "Completed" && new Date(a.appointmentDate) >= today)
    .sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate));
  const upcoming = upcomingAll[0];
  const completed = appointments.filter((a) => a.status === "Completed");
  const recentReports = completed.slice(0, 3);

  const lastVisit = completed[0]?.appointmentDate;
  const age = ageFrom(patient?.dob);

  const stats = [
    {
      label: "Upcoming appointments",
      value: upcomingAll.length,
      caption: upcoming ? `Next on ${formatDate(upcoming.appointmentDate)}` : "Nothing scheduled",
      Icon: CalendarBlank,
      tone: "bg-primary-50 text-primary-600 dark:bg-primary-500/10",
    },
    {
      label: "Completed visits",
      value: completed.length,
      caption: lastVisit ? `Last on ${formatDate(lastVisit)}` : "No visits yet",
      Icon: CheckCircle,
      tone: "bg-success-50 text-success-600 dark:bg-success-500/10",
    },
    {
      label: "Medical reports",
      value: completed.length,
      caption: completed.length ? "Available to download" : "Issued after each visit",
      Icon: FileText,
      tone: "bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10",
    },
    {
      label: "Total appointments",
      value: appointments.length,
      caption: "Across all branches",
      Icon: Heartbeat,
      tone: "bg-warning-50 text-warning-600 dark:bg-warning-500/10",
    },
  ];

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-[1400px] mx-auto">
        {/* HEADER */}
        <header className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8 animate-slide-up">
          <div>
            <h1 className="text-[32px] sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
              {greeting()}, {(patient?.name || "").split(" ")[0] || "there"}
            </h1>
            <p className="text-base text-slate-500 dark:text-slate-500 mt-2">
              Here is your health overview and recent updates.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <p className="hidden sm:block text-sm text-slate-500 dark:text-slate-500">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              })}
            </p>
            <Link
              to="/doctors"
              className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 shadow-[0_8px_20px_-6px_rgba(37,99,235,0.5)]"
            >
              <CalendarPlus weight="bold" className="w-4 h-4" aria-hidden />
              Book appointment
            </Link>
          </div>
        </header>

        {/* STATS */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8 animate-slide-up">
          {stats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* MAIN */}
          <div className="xl:col-span-8 space-y-6">
            <Panel
              title="Upcoming appointment"
              action={
                upcomingAll.length > 1 && (
                  <Link to="/my-appointments" className="text-sm font-medium text-primary-600 hover:text-primary-700">
                    View all
                  </Link>
                )
              }
            >
              {!upcoming ? (
                <div className="text-center py-8">
                  <div className="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
                    <CalendarBlank weight="duotone" className="w-8 h-8 text-primary-600" aria-hidden />
                  </div>
                  <p className="text-base font-semibold text-slate-900 dark:text-white">No appointments scheduled</p>
                  <p className="text-sm text-slate-500 dark:text-slate-500 mt-1.5 max-w-sm mx-auto">
                    Book your first consultation with one of our specialists.
                  </p>
                  <Link
                    to="/doctors"
                    className="inline-flex items-center gap-2 h-11 px-5 mt-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150"
                  >
                    <CalendarPlus weight="bold" className="w-4 h-4" aria-hidden />
                    Book appointment
                  </Link>
                </div>
              ) : (
                <div className="rounded-2xl border border-slate-200 dark:border-surface-border p-5">
                  <div className="flex items-start justify-between gap-4 mb-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-12 h-12 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
                        <span className="text-white font-bold">
                          {(upcoming.doctorId?.name || "D").trim().charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-900 dark:text-white truncate">
                          {upcoming.doctorId?.name || "Doctor"}
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-500 truncate">
                          {upcoming.doctorId?.specialization || "Consultation"}
                        </p>
                      </div>
                    </div>
                    <span className={getStatusBadgeClass(upcoming.status)}>{upcoming.status}</span>
                  </div>

                  <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 py-4 border-y border-slate-200 dark:border-surface-border">
                    <div>
                      <dt className="text-xs text-slate-500 dark:text-slate-500">Date</dt>
                      <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">
                        {formatDate(upcoming.appointmentDate)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 dark:text-slate-500">Time</dt>
                      <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5">{upcoming.slot}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-slate-500 dark:text-slate-500">Token</dt>
                      <dd className="text-sm font-medium text-slate-900 dark:text-white mt-0.5 font-mono">
                        {upcoming.tokenNumber !== null && upcoming.tokenNumber !== undefined
                          ? String(upcoming.tokenNumber).padStart(2, "0")
                          : "On check-in"}
                      </dd>
                    </div>
                  </dl>

                  <Link
                    to={`/appointment/${upcoming._id}`}
                    className="inline-flex items-center gap-1.5 mt-4 text-sm font-semibold text-primary-600 hover:text-primary-700 group"
                  >
                    View details
                    <ArrowRight className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5" aria-hidden />
                  </Link>
                </div>
              )}
            </Panel>

            <Panel
              title="Recent medical reports"
              action={
                recentReports.length > 0 && (
                  <Link to="/medical-reports" className="text-sm font-medium text-primary-600 hover:text-primary-700">
                    View all
                  </Link>
                )
              }
            >
              {recentReports.length === 0 ? (
                <div className="flex items-center gap-4 rounded-2xl border border-slate-200 dark:border-surface-border p-5">
                  <div className="w-11 h-11 rounded-xl bg-secondary-50 dark:bg-secondary-500/10 flex items-center justify-center shrink-0">
                    <FileText weight="duotone" className="w-6 h-6 text-secondary-600" aria-hidden />
                  </div>
                  <div>
                    <p className="font-medium text-slate-900 dark:text-white">No reports yet</p>
                    <p className="text-sm text-slate-500 dark:text-slate-500 mt-0.5">
                      A report is issued after each completed consultation.
                    </p>
                  </div>
                </div>
              ) : (
                <ul className="divide-y divide-slate-200 dark:divide-surface-border">
                  {recentReports.map((a) => (
                    <li key={a._id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                      <div className="w-11 h-11 rounded-2xl bg-slate-100 dark:bg-surface flex items-center justify-center shrink-0">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">
                          {(a.doctorId?.name || "D").trim().charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-slate-900 dark:text-white truncate">
                          {a.doctorId?.name || "Doctor"}
                        </p>
                        <p className="text-sm text-slate-500 dark:text-slate-500 truncate">
                          {a.doctorId?.specialization || "Consultation"} · {formatDate(a.appointmentDate)}
                        </p>
                      </div>
                      <Link
                        to={`/appointment/${a._id}`}
                        className="text-sm font-semibold text-primary-600 hover:text-primary-700 shrink-0"
                      >
                        View report
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>

          {/* RIGHT COLUMN */}
          <aside className="xl:col-span-4 space-y-6">
            {/* Only fields the record actually holds. Blood pressure, heart
                rate and BMI are deliberately absent: nothing in the system
                captures them, and inventing readings in a patient-facing
                health app would be read as real clinical data. */}
            <Panel
              title="Health summary"
              action={
                <Link to="/profile" className="text-sm font-medium text-primary-600 hover:text-primary-700">
                  Edit
                </Link>
              }
            >
              <dl className="space-y-3">
                {[
                  { label: "Blood group", value: patient?.bloodGroup, Icon: Drop, tone: "text-danger-600 bg-danger-50 dark:bg-danger-500/10" },
                  { label: "Age", value: age ? `${age} years` : null, Icon: User, tone: "text-primary-600 bg-primary-50 dark:bg-primary-500/10" },
                  { label: "Gender", value: patient?.gender, Icon: User, tone: "text-secondary-600 bg-secondary-50 dark:bg-secondary-500/10" },
                ].map(({ label, value, Icon, tone }) => (
                  <div key={label} className="flex items-center gap-3">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
                      <Icon weight="duotone" className="w-5 h-5" aria-hidden />
                    </div>
                    <dt className="text-sm text-slate-500 dark:text-slate-500 flex-1">{label}</dt>
                    <dd className={`text-sm font-semibold ${value ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-500"}`}>
                      {value || "Not recorded"}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-4 pt-4 border-t border-slate-200 dark:border-surface-border">
                Vitals such as blood pressure and weight are recorded by your care team during a visit.
              </p>
            </Panel>

            {/* Every number here is real: 108 is India's national ambulance
                line, and the branch phone comes from the Hospital record. */}
            <Panel title="Emergency">
              <a
                href="tel:108"
                className="flex items-center gap-3 rounded-2xl bg-danger-50 dark:bg-danger-500/10 border border-danger-200 dark:border-danger-500/20 p-4 hover:bg-danger-100 dark:hover:bg-danger-500/20 transition-colors duration-150"
              >
                <div className="w-10 h-10 rounded-xl bg-danger-600 flex items-center justify-center shrink-0">
                  <Ambulance weight="fill" className="w-5 h-5 text-white" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-danger-700 dark:text-danger-300">Call 108</p>
                  <p className="text-xs text-danger-600/80 dark:text-danger-400/80">National ambulance, 24/7</p>
                </div>
              </a>

              {branch?.phone && (
                <a
                  href={`tel:${branch.phone.replace(/\s+/g, "")}`}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-surface-border p-4 mt-3 hover:bg-slate-50 dark:hover:bg-surface transition-colors duration-150"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                    <Phone weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                      {branch.branch || "Hospital"} branch
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-500 font-mono truncate">{branch.phone}</p>
                  </div>
                </a>
              )}

              {patient?.emergencyContact?.phone ? (
                <a
                  href={`tel:${patient.emergencyContact.phone}`}
                  className="flex items-center gap-3 rounded-2xl border border-slate-200 dark:border-surface-border p-4 mt-3 hover:bg-slate-50 dark:hover:bg-surface transition-colors duration-150"
                >
                  <div className="w-10 h-10 rounded-xl bg-warning-50 dark:bg-warning-500/10 flex items-center justify-center shrink-0">
                    <ShieldPlus weight="duotone" className="w-5 h-5 text-warning-600" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                      {patient.emergencyContact.name || "Emergency contact"}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-500 font-mono truncate">
                      {patient.emergencyContact.phone}
                    </p>
                  </div>
                </a>
              ) : (
                <Link
                  to="/profile"
                  className="flex items-center gap-3 rounded-2xl border border-dashed border-slate-300 dark:border-surface-border p-4 mt-3 hover:bg-slate-50 dark:hover:bg-surface transition-colors duration-150"
                >
                  <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-surface flex items-center justify-center shrink-0">
                    <ShieldPlus weight="duotone" className="w-5 h-5 text-slate-500" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-700 dark:text-slate-300 text-sm">Add an emergency contact</p>
                    <p className="text-xs text-slate-500 dark:text-slate-500">So we know who to reach</p>
                  </div>
                </Link>
              )}

              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-200 dark:border-surface-border">
                <Clock weight="duotone" className="w-4 h-4 text-slate-500 shrink-0" aria-hidden />
                <p className="text-xs text-slate-500 dark:text-slate-500">
                  Emergency care is open 24/7 at both branches.
                </p>
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}

export default PatientDashboard;
