import { getStatusBadgeClass } from '../utils/statusBadge';
import { isInQueue } from '../utils/queueStatus';

// Compact horizontal token-sequence strip - the "at a glance" operational
// view a receptionist scans between patients, distinct from the full data
// table below it. Built entirely from data ReceptionistDashboard.jsx
// already fetches (no new API calls) - only patients who have actually
// arrived appear here, ordered by token. Arrival is checkedInAt, never the
// presence of a token: tokens are assigned at booking, so a token-based
// filter would put the whole day's bookings on the strip.
function QueueTimeline({ patients }) {
  const tokenized = patients
    .filter(isInQueue)
    .sort((a, b) => a.tokenNumber - b.tokenNumber);

  if (tokenized.length === 0) return null;

  return (
    <div className="card rounded-2xl p-4 sm:p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="section-title">Queue Timeline</h3>
        <span className="text-xs text-slate-500 dark:text-slate-500">
          {tokenized.length} token{tokenized.length === 1 ? '' : 's'} today
        </span>
      </div>

      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {tokenized.map((patient, idx) => {
          const isLast = idx === tokenized.length - 1;
          const isServing = patient.status?.toLowerCase() === 'in consultation';
          const isCompleted = patient.status?.toLowerCase() === 'completed';

          return (
            <div key={patient._id} className="flex items-center shrink-0">
              <div
                className={`flex flex-col items-center justify-center w-11 h-11 rounded-xl font-mono font-bold text-sm shrink-0 transition-colors duration-200 ${
                  isServing
                    ? 'bg-primary-600 text-white'
                    : isCompleted
                      ? 'bg-success-100 text-success-700 dark:bg-success-500/15 dark:text-success-400'
                      : 'bg-slate-100 text-slate-700 dark:bg-slate-700/50 dark:text-slate-200'
                }`}
                title={`${patient.patientName} · ${patient.status}`}
              >
                {String(patient.tokenNumber).padStart(2, '0')}
              </div>
              {!isLast && (
                <div className="w-4 sm:w-6 h-px bg-slate-200 dark:bg-slate-700 shrink-0" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default QueueTimeline;
