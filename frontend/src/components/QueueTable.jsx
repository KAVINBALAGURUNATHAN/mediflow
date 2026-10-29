import { useState, useRef } from 'react';
import { ClipboardText, CalendarBlank, CheckCircle } from '@phosphor-icons/react';
import { receptionistAPI } from '../services/api';
import { isCheckedIn as hasArrived } from '../utils/queueStatus';
import LoadingSpinner from './LoadingSpinner';
import useFlipRows from '../hooks/useFlipRows';

const CARD =
  'bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

const PILL =
  'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12.5px] font-semibold';

const SELECT =
  'w-full h-11 px-3 rounded-lg border border-slate-300 dark:border-surface-border bg-white dark:bg-surface text-sm text-slate-900 dark:text-slate-100 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none transition duration-150 disabled:opacity-50';

const statusBadge = (status) => {
  const s = status?.toLowerCase();

  if (s === 'waiting') {
    return (
      <span className={`${PILL} bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400`}>
        <span
          className="w-1.5 h-1.5 rounded-full bg-warning-500"
          aria-hidden="true"
        />
        Waiting
      </span>
    );
  }

  if (s === 'in consultation') {
    return (
      <span className={`${PILL} bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300`}>
        <span
          className="w-1.5 h-1.5 rounded-full bg-primary-500 animate-pulse"
          aria-hidden="true"
        />
        In Consultation
      </span>
    );
  }

  if (s === 'completed') {
    return (
      <span className={`${PILL} bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300`}>
        <CheckCircle weight="duotone" className="w-3.5 h-3.5" aria-hidden="true" />
        Completed
      </span>
    );
  }

  if (s === 'cancelled') {
    return (
      <span className={`${PILL} bg-danger-50 text-danger-700 dark:bg-danger-500/10 dark:text-danger-300`}>
        Cancelled
      </span>
    );
  }

  return (
    <span className={`${PILL} bg-slate-100 text-slate-600 dark:bg-surface dark:text-slate-300`}>
      {status || 'Booked'}
    </span>
  );
};

// Arrival as a wall-clock time, so it can be read against the slot label
// printed beside it.
const fmtArrival = (iso) => {
  if (!iso) return '—';

  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
};

const fmtDate = (iso) => {
  if (!iso) return '—';

  return new Date(iso).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const EmptyState = () => {
  return (
    <div className="py-8 px-6 flex items-center gap-4">
      <div className="w-11 h-11 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
        <CalendarBlank weight="duotone" className="w-6 h-6 text-primary-600" aria-hidden="true" />
      </div>

      <div>
        <p className="text-sm font-semibold text-slate-900 dark:text-white">
          No booked appointments
        </p>

        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
          Patient-booked appointments will appear here
        </p>
      </div>
    </div>
  );
};

const QueueTable = ({
  patients,
  loading,
  onDelete,
  onQueueUpdated,
  // Sent by the server alongside the appointments, so the wording here and
  // the rule the server actually enforces can never drift apart.
  graceMinutes = 5,
}) => {
  const [priorities, setPriorities] = useState({});
  const [priorityReasons, setPriorityReasons] = useState({});
  const [checkingIn, setCheckingIn] = useState(null);
  const [movingToList, setMovingToList] = useState(null);
  const [keeping, setKeeping] = useState(null);
  const [updatingPriority, setUpdatingPriority] = useState(null);
  const [error, setError] = useState('');
  const tbodyRef = useRef(null);
  useFlipRows(tbodyRef, patients, (p) => p._id);

  // Vitals are read-only here. Recording and correcting them belongs to the
  // nurse (NurseDashboard), who takes the measurement - a receptionist token
  // is refused by the backend, so an input here would only ever fail.
  const getPriority = (patient) => {
    return priorities[patient._id] || patient.priority || 'Normal';
  };

  const getPriorityReason = (patient) => {
    return priorityReasons[patient._id] ?? patient.priorityReason ?? '';
  };

  // A reason always implies High priority - draft state mirrors what the
  // backend will enforce (see receptionistController.js's checkIn/
  // updatePriority) so the dropdown doesn't show "Normal" while a reason
  // that's about to force it to "High" is already selected.
  const handlePriorityChange = (id, value) => {
    setPriorities((prev) => ({
      ...prev,
      [id]: value,
    }));
  };

  const handlePriorityReasonChange = (id, value) => {
    setPriorityReasons((prev) => ({
      ...prev,
      [id]: value,
    }));
    if (value) {
      setPriorities((prev) => ({ ...prev, [id]: 'High' }));
    }
  };

  // "Move to Waiting List" - the OTHER half of the decision reception makes
  // about a late patient. Check In is "keep in the normal queue"; this is
  // "they cannot use their slot any more, hand them to the vacancy workflow".
  //
  // Nothing does this automatically. A slot time passing is not a decision,
  // and a five-minute-late patient normally just gets checked in as usual -
  // which is why this sits BESIDE Check In rather than replacing it.
  const handleMoveToWaitingList = async (patient) => {
    setMovingToList(patient._id);
    setError('');

    try {
      const res = await receptionistAPI.addToWaitingList({
        appointmentId: patient._id,
      });
      // The server releases their slot as a genuine vacancy and lists them
      // with their priority intact.
      setError('');
      if (onQueueUpdated) await onQueueUpdated();
      return res;
    } catch (err) {
      setError(
        err.message || 'Could not move this patient to the waiting list'
      );
    } finally {
      setMovingToList(null);
    }
  };

  // "Keep in Queue" - the other half of the late-arrival decision. It changes
  // nothing about the queue on purpose; it records that reception looked at
  // this patient and chose to leave them where they are, so the row stops
  // asking.
  const handleKeepInQueue = async (patient) => {
    setKeeping(patient._id);
    setError('');

    try {
      await receptionistAPI.keepInQueue(patient._id);
      if (onQueueUpdated) await onQueueUpdated();
    } catch (err) {
      setError(err.message || 'Could not keep this patient in the queue');
    } finally {
      setKeeping(null);
    }
  };

  const handleCheckIn = async (patient) => {
    const priority = getPriority(patient);
    const priorityReason = getPriorityReason(patient);

    setCheckingIn(patient._id);
    setError('');

    try {
      await receptionistAPI.checkIn(patient._id, priority, priorityReason);

      if (onQueueUpdated) {
        await onQueueUpdated();
      }
    } catch (err) {
      setError(
        err.message || 'Failed to check in appointment'
      );
    } finally {
      setCheckingIn(null);
    }
  };

  // For a patient already checked in and still waiting - lets reception
  // bump someone's priority (e.g. a walk-in emergency) without cancelling
  // or re-booking anyone; everyone else's relative order in the queue is
  // untouched, only the priority-sorted position changes.
  const handleLivePriorityUpdate = async (patient, priority, priorityReason) => {
    setUpdatingPriority(patient._id);
    setError('');

    try {
      await receptionistAPI.updatePriority(patient._id, priority, priorityReason);

      if (onQueueUpdated) {
        await onQueueUpdated();
      }
    } catch (err) {
      setError(err.message || 'Failed to update priority');
    } finally {
      setUpdatingPriority(null);
    }
  };

  const PRIORITY_REASONS = [
    { value: '', label: 'No reason' },
    { value: 'Senior Citizen', label: 'Senior Citizen' },
    { value: 'Emergency', label: 'Emergency' },
    { value: 'Pregnant', label: 'Pregnant' },
    { value: 'Disabled', label: 'Disabled' },
  ];

  if (loading) {
    return (
      <div className={`${CARD} overflow-hidden`}>
        <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-surface-border">
          <div className="h-5 w-32 rounded bg-slate-100 dark:bg-surface animate-pulse" />
        </div>

        <LoadingSpinner
          variant="skeleton"
          text="Loading appointments…"
        />
      </div>
    );
  }

  return (
    <div className={`${CARD} overflow-hidden`}>

      <div className="px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-surface-border flex items-center justify-between gap-3">

        <div className="flex items-center gap-3 min-w-0">
          <span className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 text-primary-600 flex items-center justify-center shrink-0">
            <ClipboardText weight="duotone" className="w-5 h-5" aria-hidden="true" />
          </span>

          <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
            Booked Appointments
          </h2>
        </div>

        <span className="shrink-0 text-xs font-semibold text-slate-600 dark:text-slate-400 bg-slate-100 dark:bg-surface px-3 py-1 rounded-full font-mono">
          {patients.length}{' '}
          {patients.length === 1
            ? 'appointment'
            : 'appointments'}
        </span>
      </div>

      {error && (
        <div className="mx-5 mt-4 px-4 py-3 rounded-xl bg-danger-50 dark:bg-danger-500/10 text-danger-700 dark:text-danger-300 text-sm">
          {error}
        </div>
      )}

      {patients.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto max-h-[520px] overflow-y-auto">

          <table
            className="w-full text-sm table-sticky-head"
            role="table"
          >
            <thead>
              <tr>
                <th scope="col" className="text-left px-4 sm:px-6 py-3 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Token
                </th>

                <th scope="col" className="text-left px-4 sm:px-6 py-3 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Patient
                </th>

                <th scope="col" className="text-left px-4 sm:px-6 py-3 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Doctor
                </th>

                <th scope="col" className="text-left px-4 sm:px-6 py-3 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 whitespace-nowrap hidden md:table-cell">
                  Appointment
                </th>

                <th scope="col" className="text-left px-4 sm:px-6 py-3 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Priority
                </th>

                <th scope="col" className="text-left px-4 sm:px-6 py-3 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Vitals
                </th>

                <th scope="col" className="text-left px-4 sm:px-6 py-3 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Status
                </th>

                <th scope="col" className="text-left px-4 sm:px-6 py-3 text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Action
                </th>
              </tr>
            </thead>

            <tbody ref={tbodyRef} className="divide-y divide-slate-100 dark:divide-surface-border">

              {patients.map((patient, idx) => {
                const hasToken =
                  patient.tokenNumber !== null &&
                  patient.tokenNumber !== undefined;

                const isWaiting =
                  patient.status?.toLowerCase() ===
                  'waiting';

                const isInConsultation =
                  patient.status?.toLowerCase() ===
                  'in consultation';

                const isCompleted =
                  patient.status?.toLowerCase() ===
                  'completed';

                // Keyed on checkedInAt, not on the token. Tokens are now
                // issued at booking time so the patient is visible in the
                // queue straight away, which means holding a token no longer
                // means they have physically arrived - inferring it from the
                // token showed every freshly booked patient as "Checked In"
                // and hid the receptionist's Check In button entirely.
                // Mirrors the backend, where checkIn() also gates on
                // checkedInAt.
                // In consultation or completed implies arrival even for a
                // legacy row saved before checkedInAt was stamped.
                const isCheckedIn =
                  hasArrived(patient) || isInConsultation || isCompleted;

                return (
                  <tr
                    key={patient._id}
                    data-flip-key={patient._id}
                    className="group transition duration-150 animate-fade-in hover:bg-slate-50/70 dark:hover:bg-white/[0.03]"
                    style={{
                      animationDelay: `${idx * 40}ms`,
                    }}
                  >

                    {/* TOKEN */}
                    <td className="px-4 sm:px-6 py-4">
                      <span className="inline-flex items-center justify-center min-w-[2.5rem] h-10 px-2 rounded-xl font-mono font-bold text-lg bg-slate-100 dark:bg-surface text-slate-900 dark:text-slate-200">
                        {hasToken
                          ? String(
                              patient.tokenNumber
                            ).padStart(2, '0')
                          : '—'}
                      </span>
                    </td>

                    {/* PATIENT */}
                    <td className="px-4 sm:px-6 py-4">
                      <div>
                        <p className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-primary-700 dark:group-hover:text-primary-300 transition duration-150">
                          {patient.patientName}
                        </p>

                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-medium">
                          Age {patient.age}
                        </p>

                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 font-mono">
                          {patient.bookingId}
                        </p>
                      </div>
                    </td>

                    {/* DOCTOR - the receptionist books across every doctor,
                        so the row is ambiguous without it. Populated by
                        GET /receptionist/appointments. */}
                    <td className="px-4 sm:px-6 py-4">
                      <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                        {patient.doctorId?.name || "—"}
                      </p>

                      {patient.doctorId?.specialization && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                          {patient.doctorId.specialization}
                        </p>
                      )}
                    </td>

                    {/* APPOINTMENT */}
                    <td className="px-4 sm:px-6 py-4 hidden md:table-cell">
                      <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                        {fmtDate(
                          patient.appointmentDate
                        )}
                      </p>

                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {patient.slot}
                      </p>
                    </td>

                    {/* PRIORITY */}
                    <td className="px-4 sm:px-6 py-4">
                      {isInConsultation || isCompleted ? (
                        <div className="flex flex-col gap-1">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                            {patient.priority || 'Normal'}
                          </span>
                          {patient.priorityReason && (
                            <span className="inline-block w-fit text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-danger-50 dark:bg-danger-500/10 text-danger-700 dark:text-danger-400">
                              {patient.priorityReason}
                            </span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-col gap-1.5">
                          <select
                            value={getPriority(patient)}
                            onChange={(e) => {
                              if (isWaiting) {
                                handleLivePriorityUpdate(
                                  patient,
                                  e.target.value,
                                  getPriorityReason(patient)
                                );
                              } else {
                                handlePriorityChange(patient._id, e.target.value);
                              }
                            }}
                            disabled={updatingPriority === patient._id}
                            className={`${SELECT} min-w-[130px]`}
                          >
                            <option value="High">High</option>
                            <option value="Normal">Normal</option>
                            <option value="Low">Low</option>
                          </select>

                          <select
                            value={getPriorityReason(patient)}
                            onChange={(e) => {
                              if (isWaiting) {
                                handleLivePriorityUpdate(
                                  patient,
                                  e.target.value ? 'High' : getPriority(patient),
                                  e.target.value
                                );
                              } else {
                                handlePriorityReasonChange(patient._id, e.target.value);
                              }
                            }}
                            disabled={updatingPriority === patient._id}
                            className={`${SELECT} min-w-[130px]`}
                          >
                            {PRIORITY_REASONS.map((r) => (
                              <option key={r.value} value={r.value}>
                                {r.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </td>

                    {/* VITALS - read-only; the nurse records them */}
                    <td className="px-4 sm:px-6 py-4">
                      {patient.vitals?.bmi ? (
                        <div className="flex flex-col leading-tight">
                          <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                            BMI {patient.vitals.bmi}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {patient.vitals.heightCm} cm · {patient.vitals.weightKg} kg
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400">
                          {isCheckedIn ? 'Awaiting nurse' : '—'}
                        </span>
                      )}
                    </td>

                    {/* STATUS */}
                    <td className="px-4 sm:px-6 py-4">
                      {statusBadge(patient.status)}
                    </td>

                    {/* ACTION */}
                    <td className="px-4 sm:px-6 py-4 align-top min-w-[13rem]">
                      {!isCheckedIn ? (
                        <div className="flex flex-col gap-1.5">
                          {/* Past their slot and still not here. Reception
                              sees it; nothing acts on it. Moving them is not
                              offered - you cannot hand a vacancy to someone
                              who is not in the building, so the decision here
                              is eventually a no-show. */}
                          {patient.isOverdue && (
                            <span className="text-[11px] font-semibold text-warning-700 dark:text-warning-400">
                              Not arrived — {patient.minutesLate} min past slot
                            </span>
                          )}

                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              onClick={() => handleCheckIn(patient)}
                              disabled={checkingIn === patient._id}
                              className="inline-flex items-center justify-center h-9 px-4 rounded-full bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
                            >
                              {checkingIn === patient._id
                                ? 'Checking in…'
                                : 'Check In'}
                            </button>
                          </div>
                        </div>
                      ) : isWaiting ? (
                        <div className="flex flex-col gap-1.5">
                          {patient.isLateArrival ? (
                            <>
                              {/* Arrived after the grace period. They keep
                                  their slot until reception decides
                                  otherwise - nothing here is automatic. The
                                  arrival time is spelled out beside the slot
                                  because "late by 6 min" is a conclusion, and
                                  the desk should be able to check it against
                                  the two times it came from. */}
                              <span className="text-[11px] font-semibold text-warning-700 dark:text-warning-400 whitespace-normal">
                                LATE — beyond {graceMinutes}-minute grace period
                              </span>

                              <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-normal">
                                Appointment {patient.slot} · Arrived{' '}
                                {fmtArrival(patient.checkedInAt)} (
                                {patient.minutesLate} min late)
                              </span>

                              {patient.lateDecision === 'KeptInQueue' ? (
                                // Already decided. The buttons are gone
                                // rather than disabled: the question has been
                                // answered, and an answered question should
                                // stop being asked.
                                <span className="text-xs font-semibold text-success-700 dark:text-success-400 whitespace-normal">
                                  Kept in queue by reception
                                </span>
                              ) : (
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    onClick={() => handleKeepInQueue(patient)}
                                    disabled={keeping === patient._id}
                                    className="inline-flex items-center justify-center h-9 px-3 rounded-full bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
                                    title="Leave them exactly where they are - same slot, same priority, same position"
                                  >
                                    {keeping === patient._id
                                      ? 'Keeping…'
                                      : 'Keep in Queue'}
                                  </button>

                                  <button
                                    onClick={() => handleMoveToWaitingList(patient)}
                                    disabled={movingToList === patient._id}
                                    className="inline-flex items-center justify-center h-9 px-3 rounded-full border border-slate-300 dark:border-surface-border text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition duration-150 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
                                    title="Releases their slot as a vacancy and lists them with their priority intact"
                                  >
                                    {movingToList === patient._id
                                      ? 'Moving…'
                                      : 'Move to Waiting List'}
                                  </button>
                                </div>
                              )}
                            </>
                          ) : (
                            // On time, or within the grace period - which is
                            // the same thing as far as the queue is
                            // concerned. No waiting-list control is offered
                            // here at all, because there is nothing to decide.
                            <>
                              <span className="text-xs font-semibold text-success-700 dark:text-success-400 whitespace-normal">
                                Checked In — Within Grace Period
                              </span>
                              <span className="text-[11px] text-slate-500 dark:text-slate-400 whitespace-normal">
                                Appointment {patient.slot} · Arrived{' '}
                                {fmtArrival(patient.checkedInAt)}
                              </span>
                            </>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500">
                          —
                        </span>
                      )}

                      {onDelete && !isCheckedIn && (
                        <button
                          onClick={() =>
                            onDelete(patient._id)
                          }
                          className="ml-2 text-xs font-semibold text-danger-600 hover:text-danger-700 transition duration-150"
                          aria-label={`Cancel ${patient.patientName}`}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default QueueTable;