import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { XCircle, CalendarBlank, WarningCircle } from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "./ConfirmModal";

const EASE = [0.16, 1, 0.3, 1];

// Cancel / reschedule controls a patient can use on their own appointment.
//
// The server is the authority on every rule here (ownership, status, past
// dates, slot clashes - see cancelMyAppointment / rescheduleMyAppointment).
// This component only hides controls that obviously cannot apply, so a
// patient is not offered an action that will certainly fail; anything it
// lets through is still re-checked server-side.
function AppointmentActions({ appointment, onChanged }) {
  const toast = useToast();
  const reduceMotion = useReducedMotion();

  const [confirm, setConfirm] = useState(null);
  const [rescheduling, setRescheduling] = useState(false);
  const [date, setDate] = useState("");
  const [slot, setSlot] = useState("");
  const [slots, setSlots] = useState([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const status = appointment?.status;
  const isOver = status === "Completed" || status === "Cancelled";
  const inProgress = status === "In Consultation";
  if (!appointment || isOver || inProgress) return null;

  const doctorId = appointment.doctorId?._id || appointment.doctorId;
  const today = new Date().toISOString().split("T")[0];

  const loadSlots = async (nextDate) => {
    setDate(nextDate);
    setSlot("");
    setSlots([]);
    setError("");
    if (!nextDate || !doctorId) return;
    try {
      setLoadingSlots(true);
      const res = await API.get(`/doctors/${doctorId}/slots?date=${nextDate}`);
      setSlots(res.data.slots || []);
    } catch (err) {
      setError(err.response?.data?.message || "Could not load available slots.");
    } finally {
      setLoadingSlots(false);
    }
  };

  const doCancel = async () => {
    try {
      setBusy(true);
      await API.patch(`/patient/appointments/${appointment._id}/cancel`);
      toast.success("Appointment cancelled.");
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not cancel the appointment.");
    } finally {
      setBusy(false);
    }
  };

  const doReschedule = async () => {
    setError("");
    if (!date || !slot) {
      setError("Pick a date and a time slot.");
      return;
    }
    try {
      setBusy(true);
      await API.patch(`/patient/appointments/${appointment._id}/reschedule`, {
        appointmentDate: date,
        slot,
      });
      toast.success("Appointment rescheduled.");
      setRescheduling(false);
      onChanged?.();
    } catch (err) {
      setError(err.response?.data?.message || "Could not reschedule. Try another slot.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-4 mt-4 border-t border-slate-100 dark:border-surface-border">
        <button
          type="button"
          onClick={() => setRescheduling((v) => !v)}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-slate-300 dark:border-surface-border text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800/60 active:scale-[0.98] transition duration-150"
        >
          <CalendarBlank weight="duotone" className="w-4 h-4" aria-hidden />
          {rescheduling ? "Close" : "Reschedule"}
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() =>
            setConfirm({
              title: "Cancel this appointment?",
              message:
                "Your slot will be released and the doctor's queue updated. You can book again at any time.",
              variant: "danger",
              confirmLabel: "Cancel appointment",
              onConfirm: doCancel,
            })
          }
          className="inline-flex items-center gap-2 h-10 px-4 rounded-full text-sm font-medium text-danger-600 hover:bg-danger-50 dark:hover:bg-danger-500/10 active:scale-[0.98] transition duration-150 disabled:opacity-60 disabled:pointer-events-none"
        >
          <XCircle weight="duotone" className="w-4 h-4" aria-hidden />
          Cancel
        </button>
      </div>

      {rescheduling && (
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="mt-3 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-surface-border"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor={`resched-date-${appointment._id}`}
                className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                New date
              </label>
              <input
                id={`resched-date-${appointment._id}`}
                type="date"
                min={today}
                value={date}
                onChange={(e) => loadSlots(e.target.value)}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 dark:border-surface-border bg-white dark:bg-surface-card text-[15px] text-slate-900 dark:text-white outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition duration-150"
              />
            </div>

            <div>
              <label
                htmlFor={`resched-slot-${appointment._id}`}
                className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                New time
              </label>
              <select
                id={`resched-slot-${appointment._id}`}
                value={slot}
                onChange={(e) => setSlot(e.target.value)}
                disabled={!date || loadingSlots || slots.length === 0}
                className="w-full h-11 px-3.5 rounded-lg border border-slate-300 dark:border-surface-border bg-white dark:bg-surface-card text-[15px] text-slate-900 dark:text-white outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition duration-150 disabled:opacity-60"
              >
                <option value="">
                  {!date
                    ? "Pick a date first"
                    : loadingSlots
                    ? "Loading…"
                    : slots.length === 0
                    ? "No slots available"
                    : "Select a slot"}
                </option>
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {error && (
            <p className="mt-3 flex items-start gap-2 text-xs text-danger-600">
              <WarningCircle weight="fill" className="w-4 h-4 shrink-0 mt-px" aria-hidden />
              {error}
            </p>
          )}

          <motion.button
            type="button"
            onClick={doReschedule}
            disabled={busy || !date || !slot}
            whileTap={reduceMotion ? {} : { scale: 0.98 }}
            className="mt-4 w-full sm:w-auto inline-flex items-center justify-center h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 transition-colors duration-150 disabled:opacity-60 disabled:pointer-events-none"
          >
            {busy ? "Rescheduling…" : "Confirm new time"}
          </motion.button>
        </motion.div>
      )}

      <ConfirmModal config={confirm} onClose={() => setConfirm(null)} />
    </>
  );
}

export default AppointmentActions;
