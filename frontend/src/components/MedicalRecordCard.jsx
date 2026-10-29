// Shared read-only medical record display - used on the Medical Reports
// page, the Dashboard's "Recent Reports" preview, and the single
// Appointment Detail page, so all three stay visually/behaviorally
// identical instead of drifting apart.
function MedicalRecordCard({ appointment, onDownload }) {
  if (appointment.status !== "Completed") return null;

  // The backend now refuses to mark a consultation Completed without both
  // of these set (see PATCH /appointments/:id), but appointments completed
  // before that validation existed can still have status === "Completed"
  // with an empty diagnosis/prescription. Rather than render "Completed"
  // next to "Not provided" (which reads as a broken record to a patient),
  // treat that combination as an unfinished record and say so honestly.
  const hasRecord = Boolean(appointment.diagnosis?.trim() && appointment.prescription?.trim());

  if (!hasRecord) {
    return (
      <div className="card rounded-xl p-4 sm:p-5 space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">Medical Record</h4>
          <span className="badge-waiting">Awaiting Medical Record</span>
        </div>
        <p className="text-sm text-slate-500 dark:text-slate-500">
          This consultation has not yet been finalized by the doctor.
        </p>
      </div>
    );
  }

  return (
    <div className="card rounded-xl p-4 sm:p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-bold text-slate-900 dark:text-white">Medical Record</h4>
        <span className="badge-completed">Completed</span>
      </div>

      <div>
        <p className="text-xs text-slate-500 dark:text-slate-500 mb-1">Diagnosis</p>
        <p className="text-sm text-slate-700 dark:text-slate-300">{appointment.diagnosis}</p>
      </div>

      <div>
        <p className="text-xs text-slate-500 dark:text-slate-500 mb-1">Prescription</p>
        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">
          {appointment.prescription}
        </p>
      </div>

      <div>
        <p className="text-xs text-slate-500 dark:text-slate-500 mb-1">Doctor's Notes</p>
        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">
          {appointment.notes || "Not provided"}
        </p>
      </div>

      {onDownload && (
        <button onClick={() => onDownload(appointment)} className="btn-outline w-full sm:w-auto">
          Download Medical Report
        </button>
      )}
    </div>
  );
}

export default MedicalRecordCard;
