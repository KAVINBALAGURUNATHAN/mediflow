import { useState, useEffect, useCallback } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  FirstAid,
  ArrowClockwise,
  CheckCircle,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import { nurseAPI } from "../services/api";
import useSocket from "../hooks/useSocket";
import { useToast } from "../context/ToastContext";
import LoadingSpinner from "../components/LoadingSpinner";

const EASE = [0.16, 1, 0.3, 1];

// The vitals the nurse records, in the order they are taken. Bounds mirror
// backend/utils/parseVitals.js, which is the enforcing copy - these exist so a
// typo is caught while the patient is still in the room, not after a round
// trip. Keep them in step; the server is what actually decides.
const FIELDS = [
  { name: "heightCm", label: "Height", unit: "cm", step: "0.1", min: 30, max: 275 },
  { name: "weightKg", label: "Weight", unit: "kg", step: "0.1", min: 1, max: 500 },
  { name: "bloodPressureSystolic", label: "BP systolic", unit: "mmHg", step: "1", min: 50, max: 300 },
  { name: "bloodPressureDiastolic", label: "BP diastolic", unit: "mmHg", step: "1", min: 20, max: 200 },
  { name: "temperatureC", label: "Temperature", unit: "°C", step: "0.1", min: 25, max: 45 },
  { name: "pulseBpm", label: "Pulse", unit: "bpm", step: "1", min: 20, max: 250 },
  { name: "spo2", label: "SpO2", unit: "%", step: "1", min: 50, max: 100 },
  { name: "respiratoryRate", label: "Respiratory rate", unit: "/min", step: "1", min: 5, max: 80 },
];

const INPUT =
  "w-full h-11 px-3 rounded-lg border border-gray-300 bg-white text-[15px] text-gray-900 placeholder:text-gray-400 outline-none transition duration-150 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";

// Appointments arrive as ISO date strings; the slot itself is already the
// human-readable time the patient was given, so it is shown as-is rather than
// re-derived from the date (which is stored at IST midnight, not at the slot).
function slotLabel(appointment) {
  return appointment.slot || "—";
}

function draftFromVitals(vitals) {
  const draft = {};
  for (const field of FIELDS) {
    const stored = vitals?.[field.name];
    draft[field.name] = stored == null ? "" : String(stored);
  }
  return draft;
}

// Previewed live as the nurse types, before anything is saved, so a slipped
// decimal point is visible immediately. The backend recomputes BMI on write -
// this is only ever a preview, never the value that gets stored (see
// Appointment.js's pre-validate hook).
function previewBmi(draft) {
  const h = Number(draft.heightCm);
  const w = Number(draft.weightKg);
  if (!h || !w || h < 30 || h > 275 || w < 1 || w > 500) return null;
  const m = h / 100;
  return (w / (m * m)).toFixed(1);
}

function NurseDashboard() {
  const toast = useToast();
  const reduceMotion = useReducedMotion();

  const [queue, setQueue] = useState({ awaitingVitals: [], readyForDoctor: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [openId, setOpenId] = useState(null);
  const [draft, setDraft] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (quiet) setRefreshing(true);
      try {
        const res = await nurseAPI.getQueue();
        setQueue({
          awaitingVitals: res.data.awaitingVitals || [],
          readyForDoctor: res.data.readyForDoctor || [],
        });
      } catch (err) {
        toast.error(err.message || "Failed to load the queue");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load();
  }, [load]);

  // Reception emits "queueUpdated" when it checks a patient in. Every other
  // live screen already listens for it - the doctor's dashboard, the queue
  // board, the waiting room, reception's own - and this one did not, so a
  // nurse with the page already open never saw the patient arrive. The
  // patient was in the API response the whole time; the screen simply never
  // asked again until Refresh was clicked. Quiet, because a list that
  // repopulates itself does not need a spinner.
  const handleQueueUpdated = useCallback(() => {
    load({ quiet: true });
  }, [load]);

  useSocket("queueUpdated", handleQueueUpdated);

  const openFor = (appointment) => {
    setOpenId(appointment._id);
    setDraft(draftFromVitals(appointment.vitals));
  };

  const closeForm = () => {
    setOpenId(null);
    setDraft({});
  };

  const handleSave = async (appointment) => {
    setSaving(true);
    try {
      // Sent as typed. Blank means "not recorded", which the backend stores as
      // null - it is not the same as zero, so empty strings are not coerced.
      await nurseAPI.recordVitals(appointment._id, draft);
      toast.success("Vitals saved");
      closeForm();
      await load({ quiet: true });
    } catch (err) {
      toast.error(err.message || "Failed to save vitals");
    } finally {
      setSaving(false);
    }
  };

  const handleReady = async (appointment) => {
    try {
      await nurseAPI.markReady(appointment._id);
      toast.success(`${appointment.patientName} is ready for the doctor`);
      await load({ quiet: true });
    } catch (err) {
      toast.error(err.message || "Failed to mark the patient ready");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner />
      </div>
    );
  }

  const renderRow = (appointment, { ready }) => {
    const isOpen = openId === appointment._id;
    const bmi = appointment.vitals?.bmi;

    return (
      <motion.div
        key={appointment._id}
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: EASE }}
        className="rounded-2xl border border-gray-200/70 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.04)] overflow-hidden"
      >
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div className="min-w-0 flex-1">
            <p className="text-[15px] font-semibold text-gray-900 truncate">
              {appointment.patientName}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              {slotLabel(appointment)}
              {appointment.doctorId?.name ? ` · ${appointment.doctorId.name}` : ""}
              {appointment.tokenNumber ? ` · Token ${appointment.tokenNumber}` : ""}
            </p>
          </div>

          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              ready
                ? "bg-success-50 text-success-700"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {ready ? (
              <CheckCircle weight="duotone" className="w-3.5 h-3.5" aria-hidden="true" />
            ) : null}
            {ready ? "Ready for doctor" : "Waiting"}
          </span>

          <span className="text-xs font-semibold text-gray-500 tabular-nums">
            {bmi ? `BMI ${bmi}` : "BMI —"}
          </span>

          <button
            type="button"
            onClick={() => (isOpen ? closeForm() : openFor(appointment))}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150"
          >
            {isOpen ? (
              <>
                <X weight="bold" className="w-3.5 h-3.5" aria-hidden="true" />
                Close
              </>
            ) : (
              <>
                <PencilSimple weight="duotone" className="w-3.5 h-3.5" aria-hidden="true" />
                {/* The same form records and corrects - a mistyped weight has
                    to be fixable where it was entered. */}
                {ready || bmi ? "Correct" : "Record"}
              </>
            )}
          </button>
        </div>

        {isOpen && (
          <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-5">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((field) => (
                <div key={field.name}>
                  <label
                    htmlFor={`${field.name}-${appointment._id}`}
                    className="block text-[13px] font-medium text-gray-700 mb-1.5"
                  >
                    {field.label}{" "}
                    <span className="text-gray-400 font-normal">({field.unit})</span>
                  </label>
                  <input
                    id={`${field.name}-${appointment._id}`}
                    type="number"
                    inputMode="decimal"
                    step={field.step}
                    min={field.min}
                    max={field.max}
                    value={draft[field.name] ?? ""}
                    onChange={(e) =>
                      setDraft((prev) => ({ ...prev, [field.name]: e.target.value }))
                    }
                    className={INPUT}
                  />
                </div>
              ))}

              {/* BMI is derived, never typed, so it is shown as a read-only
                  result rather than an eighth input. */}
              <div>
                <p className="block text-[13px] font-medium text-gray-700 mb-1.5">
                  BMI <span className="text-gray-400 font-normal">(calculated)</span>
                </p>
                <div className="h-11 px-3 flex items-center rounded-lg border border-dashed border-gray-300 bg-white text-[15px] font-semibold text-gray-900 tabular-nums">
                  {previewBmi(draft) ?? "—"}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => handleSave(appointment)}
                disabled={saving}
                className="h-11 px-6 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none"
              >
                {saving ? "Saving…" : "Save Vitals"}
              </button>

              <button
                type="button"
                onClick={closeForm}
                className="h-11 px-5 rounded-full border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors duration-150"
              >
                Cancel
              </button>

              <p className="text-xs text-gray-500">
                Leave a field blank to leave it unrecorded. Clearing every field
                removes the vitals and withdraws the hand-off.
              </p>
            </div>
          </div>
        )}

        {!isOpen && !ready && (
          <div className="border-t border-gray-100 px-5 py-3">
            <button
              type="button"
              onClick={() => handleReady(appointment)}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-success-600 text-white text-xs font-semibold hover:bg-success-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
              disabled={!appointment.vitals?.heightCm || !appointment.vitals?.weightKg}
              title={
                appointment.vitals?.heightCm && appointment.vitals?.weightKg
                  ? undefined
                  : "Record height and weight first"
              }
            >
              <CheckCircle weight="duotone" className="w-3.5 h-3.5" aria-hidden="true" />
              Ready for Doctor
            </button>
          </div>
        )}
      </motion.div>
    );
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
            <FirstAid weight="duotone" className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <h1 className="text-[22px] font-bold text-gray-900 tracking-tight">
              Clinical Preparation
            </h1>
            {/* Says "today" explicitly: the list is day-scoped, so an empty
                one usually means nobody has been checked in TODAY rather than
                anything being wrong. Showing the date makes that obvious
                instead of leaving it to be guessed. */}
            <p className="text-xs text-gray-500">
              Patients checked in today —{" "}
              {new Date().toLocaleDateString("en-IN", {
                weekday: "short",
                day: "2-digit",
                month: "short",
              })}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => load({ quiet: true })}
          disabled={refreshing}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-gray-300 bg-white text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors duration-150 disabled:opacity-60"
        >
          <ArrowClockwise weight="bold" className="w-4 h-4" aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          Patients awaiting vitals
          <span className="ml-2 text-gray-400 font-normal tabular-nums">
            {queue.awaitingVitals.length}
          </span>
        </h2>

        {queue.awaitingVitals.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center text-sm text-gray-500">
            No patients awaiting vitals. Patients appear here once reception
            checks them in — only today's appointments can be checked in, so a
            booking for another day will not show up here yet.
          </p>
        ) : (
          <div className="space-y-3">
            {queue.awaitingVitals.map((a) => renderRow(a, { ready: false }))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-gray-900 mb-3">
          Ready for the doctor
          <span className="ml-2 text-gray-400 font-normal tabular-nums">
            {queue.readyForDoctor.length}
          </span>
        </h2>

        {queue.readyForDoctor.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-gray-300 bg-white px-5 py-8 text-center text-sm text-gray-500">
            Nobody has been handed over yet.
          </p>
        ) : (
          <div className="space-y-3">
            {queue.readyForDoctor.map((a) => renderRow(a, { ready: true }))}
          </div>
        )}
      </section>
    </div>
  );
}

export default NurseDashboard;
