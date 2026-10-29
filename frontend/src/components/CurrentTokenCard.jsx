import { useState } from "react";
import PropTypes from "prop-types";
import { User, Bell } from "@phosphor-icons/react";

const QUICK_MINUTES = [5, 10, 15, 20, 30];

// Shared "Now Serving" panel for both DoctorDashboard and
// ReceptionistDashboard. estimatedDurationMinutes/consultationStartedAt are
// optional (only present once a doctor has set an estimate for the current
// patient - see PATCH /doctor/appointments/:id/estimated-duration).
// onSetDuration is only ever passed by DoctorDashboard - its presence is
// what decides whether this renders the interactive picker (doctor) or a
// read-only remaining-time badge (reception), since only the doctor who
// owns the appointment is allowed to set it.
const CurrentTokenCard = ({
  currentToken = 0,
  patientName = "",
  estimatedDurationMinutes = null,
  consultationStartedAt = null,
  onSetDuration,
}) => {
  const token = Number(currentToken) || 0;
  const hasToken = token > 0;
  const [customMinutes, setCustomMinutes] = useState("");
  const [savingMinutes, setSavingMinutes] = useState(false);

  const remainingMinutes =
    estimatedDurationMinutes && consultationStartedAt
      ? Math.max(
          0,
          Math.round(
            estimatedDurationMinutes -
              (Date.now() - new Date(consultationStartedAt).getTime()) / 60000
          )
        )
      : null;

  const submitMinutes = async (minutes) => {
    if (!onSetDuration || !minutes || minutes < 1 || minutes > 180) return;
    setSavingMinutes(true);
    try {
      await onSetDuration(minutes);
      setCustomMinutes("");
    } finally {
      setSavingMinutes(false);
    }
  };

  return (
    <section
      className="relative overflow-hidden rounded-2xl bg-primary-600 text-white shadow-[0_8px_24px_-12px_rgba(37,99,235,0.5)] animate-fade-in"
      aria-label="Now serving"
    >
      <div className="px-6 sm:px-10 py-8 sm:py-10 lg:py-12">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-5">
              <span className="live-dot" aria-hidden="true" />

              <p className="text-[11px] font-bold text-primary-100 uppercase tracking-[0.12em]">
                Now Serving
              </p>

              {hasToken && (
                <span className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-white/15 text-[11px] font-bold uppercase tracking-[0.07em] text-primary-50">
                  Active
                </span>
              )}
            </div>

            <div className="flex items-end gap-5 sm:gap-8 flex-wrap">
              <span
                className={`font-mono font-bold tracking-tight leading-none text-white ${hasToken ? "" : "opacity-60"}`}
                style={{ fontSize: "clamp(4rem, 14vw, 7.5rem)" }}
                aria-live="polite"
              >
                {hasToken ? String(token).padStart(2, "0") : "—"}
              </span>

              {hasToken && (
                <div className="mb-2 sm:mb-4 pb-1 border-l-2 border-white/25 pl-5">
                  <p className="text-primary-100 text-[11px] font-bold uppercase tracking-[0.07em] mb-1">
                    Patient
                  </p>

                  <p
                    className="text-xl sm:text-2xl lg:text-3xl font-semibold text-white leading-tight truncate max-w-[280px] sm:max-w-md"
                    title={patientName || "In Consultation"}
                  >
                    {patientName || "In Consultation"}
                  </p>
                </div>
              )}
            </div>

            {hasToken && onSetDuration && (
              <div className="mt-5 pt-4 border-t border-white/15">
                <p className="text-primary-100 text-[11px] font-bold uppercase tracking-[0.07em] mb-2">
                  {estimatedDurationMinutes ? `Estimated ${estimatedDurationMinutes} min` : "Set estimated time"}
                  {remainingMinutes !== null && (
                    <span className="ml-2 normal-case font-normal tracking-normal text-primary-100">
                      · ~{remainingMinutes} min remaining
                    </span>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {QUICK_MINUTES.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => submitMinutes(m)}
                      disabled={savingMinutes}
                      className="inline-flex items-center justify-center h-9 px-4 rounded-full text-xs font-semibold bg-white/10 border border-white/20 text-white hover:bg-white/20 active:scale-[0.98] transition duration-150 disabled:opacity-50"
                    >
                      {m}m
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={customMinutes}
                      onChange={(e) => setCustomMinutes(e.target.value)}
                      placeholder="Custom"
                      className="w-20 h-9 px-3 rounded-lg text-xs bg-white/10 border border-white/20 text-white placeholder:text-primary-100/60 outline-none focus:border-white/50 focus:ring-4 focus:ring-white/10 transition duration-150"
                      aria-label="Custom estimated duration in minutes"
                    />
                    <button
                      type="button"
                      onClick={() => submitMinutes(Number(customMinutes))}
                      disabled={savingMinutes || !customMinutes}
                      className="inline-flex items-center justify-center h-9 px-4 rounded-full text-xs font-semibold bg-white text-primary-700 hover:bg-primary-50 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
                    >
                      Set
                    </button>
                  </div>
                </div>
              </div>
            )}

            {hasToken && !onSetDuration && remainingMinutes !== null && (
              <p className="mt-4 pt-3 border-t border-white/15 text-primary-100 text-sm">
                Est. <span className="font-semibold text-white">~{remainingMinutes} min</span> remaining
              </p>
            )}

            {!hasToken && (
              <div className="flex items-center gap-3 mt-3">
                <div className="w-10 h-10 rounded-xl bg-white/10 border border-white/20 flex items-center justify-center shrink-0" aria-hidden="true">
                  <User weight="duotone" className="w-5 h-5 text-white" />
                </div>
                <p className="text-primary-100 text-sm sm:text-base font-medium max-w-md">
                  No patients currently waiting
                </p>
              </div>
            )}
          </div>

          <div
            className="hidden lg:flex flex-col items-center justify-center w-32 h-32 rounded-2xl bg-white/10 border border-white/20 shrink-0"
            aria-hidden="true"
          >
            <Bell weight="duotone" className="w-14 h-14 text-white mb-1" />

            <span className="text-[11px] font-bold text-primary-100 uppercase tracking-[0.07em]">
              Live Queue
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

CurrentTokenCard.propTypes = {
  currentToken: PropTypes.oneOfType([
    PropTypes.number,
    PropTypes.string,
  ]),
  patientName: PropTypes.string,
  estimatedDurationMinutes: PropTypes.number,
  consultationStartedAt: PropTypes.string,
  onSetDuration: PropTypes.func,
};

export default CurrentTokenCard;