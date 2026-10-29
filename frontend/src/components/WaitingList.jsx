import { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import { UsersThree, Plus, X, ArrowRight } from "@phosphor-icons/react";
import { receptionistAPI } from "../services/api";
import { useToast } from "../context/ToastContext";
import useSocket from "../hooks/useSocket";

// The waiting/vacant list, for reception.
//
// This is the BACKUP QUEUE, not the queue: people who want to be seen but do
// not currently hold a slot. When one frees up, someone here is given it.
//
// Nothing on this screen cancels an appointment because its time passed. A
// late patient keeps their slot and their place; moving them here and marking
// a no-show are two deliberate, separate actions taken by a person who can
// actually see whether the patient is in the building.

const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const INPUT =
  "w-full h-11 px-3.5 rounded-lg text-sm bg-white dark:bg-surface text-slate-900 dark:text-white placeholder:text-slate-400 border border-slate-300 dark:border-surface-border focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none transition duration-150";
const PILL =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none";

const PRIORITY_REASONS = [
  { value: "", label: "No priority reason" },
  { value: "Senior Citizen", label: "Senior Citizen" },
  { value: "Emergency", label: "Emergency" },
  { value: "Pregnant", label: "Pregnant" },
  { value: "Disabled", label: "Disabled" },
];

function WaitingList({ doctors = [] }) {
  const toast = useToast();

  const [doctorId, setDoctorId] = useState("");
  const [entries, setEntries] = useState([]);
  const [maxWaiting, setMaxWaiting] = useState(6);
  const [vacancies, setVacancies] = useState([]);
  // Which waiting patient to put in the queue. Defaults to the front of the
  // list, so the ordinary case stays one click, but reception can pick
  // someone else when they have a reason to.
  const [queueEntryId, setQueueEntryId] = useState("");
  const [queueSlot, setQueueSlot] = useState("");
  const [recoverySlots, setRecoverySlots] = useState([]);
  const [windowStart, setWindowStart] = useState("");
  const [windowEnd, setWindowEnd] = useState("");
  const [phone, setPhone] = useState("");
  const [priorityReason, setPriorityReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState(null);

  const selectedDoctor = doctors.find((d) => String(d._id) === String(doctorId));

  const load = useCallback(async () => {
    try {
      const list = await receptionistAPI.getWaitingList(doctorId || undefined);
      setEntries(list.data.entries || []);
      setMaxWaiting(list.data.maxWaiting ?? 6);

      // Vacancies are per doctor - a slot frees up in one schedule, not the
      // clinic's - so there is nothing to show until one is chosen.
      if (doctorId) {
        const free = await receptionistAPI.getVacancies(doctorId);
        setVacancies(free.data.slots || []);
        setRecoverySlots(free.data.recoverySlots || []);
      } else {
        setVacancies([]);
        setRecoverySlots([]);
      }
    } catch (err) {
      toast.error(err.message || "Could not load the waiting list");
    }
  }, [doctorId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  // A no-show or a check-in elsewhere changes what is free here.
  useSocket("queueUpdated", load);

  // A walk-in has two possible outcomes and reception decides which:
  //
  //   WAIT  - go on the list, be given a slot when one frees up
  //   QUEUE - there is a free slot right now, so book them straight into it
  //
  // Both go through the waiting list, because a walk-in has no appointment
  // and an appointment is what the clinical queue is built from. "Add to
  // queue" is just those two steps in one click - it never inserts someone
  // into the queue without a real slot.
  const handleAdd = async ({ thenQueue = false } = {}) => {
    if (!doctorId) {
      toast.error("Choose a doctor first.");
      return;
    }

    if (!phone.trim()) {
      toast.error("Enter the patient's phone number.");
      return;
    }

    const slot = thenQueue ? queueSlot || vacancies[0] : null;

    if (thenQueue && !slot) {
      toast.error(
        "No free slot to put them in. Add them to the waiting list instead."
      );
      return;
    }

    setBusy(true);
    try {
      const res = await receptionistAPI.addToWaitingList({
        doctorId,
        phone: phone.trim(),
        priorityReason,
      });

      if (thenQueue) {
        const assigned = await receptionistAPI.assignVacancy(
          res.data.entry._id,
          slot
        );
        toast.success(assigned.data.message);
      } else {
        toast.success(res.data.message);
      }

      setPhone("");
      setPriorityReason("");
      setQueueSlot("");
      await load();
    } catch (err) {
      toast.error(err.message || "Could not add this patient");
      await load();
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (entry) => {
    try {
      await receptionistAPI.removeFromWaitingList(entry._id);
      toast.success(`${entry.patientName} removed from the waiting list`);
      await load();
    } catch (err) {
      toast.error(err.message || "Could not remove the patient");
    }
  };

  const handleAssign = async (entry, slot) => {
    if (!slot) return;

    setAssigning(entry._id);
    try {
      const res = await receptionistAPI.assignVacancy(entry._id, slot);
      toast.success(res.data.message);
      await load();
    } catch (err) {
      // The server refuses a slot that was taken while this list was open,
      // so a stale page cannot double-book. Reload so it stops offering it.
      toast.error(err.message || "Could not assign that slot");
      await load();
    } finally {
      setAssigning(null);
    }
  };

  return (
    <section className={`${CARD} p-5 sm:p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 flex items-center justify-center">
            <UsersThree weight="duotone" className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Waiting / Vacant List
              {/* Scoped to a doctor, NOT a separate waiting room. There is one
                  list; choosing a doctor filters it to the people waiting for
                  that doctor. */}
              {doctorId && selectedDoctor
                ? ` — ${selectedDoctor.name}`
                : ""}
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Patients waiting for an available appointment slot.
            </p>
          </div>
        </div>

        <span className="text-xs font-semibold text-slate-500 tabular-nums">
          {entries.length} / {maxWaiting}
        </span>
      </div>

      {/* Wraps rather than forcing a fixed 4-column grid: the two action
          buttons need real width, and squeezing them into an `auto` track was
          what pushed their labels outside the card. */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 items-end mb-5">
        <div>
          <label
            htmlFor="wl-doctor"
            className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Doctor
          </label>
          <select
            id="wl-doctor"
            value={doctorId}
            onChange={(e) => setDoctorId(e.target.value)}
            className={INPUT}
          >
            <option value="">All doctors</option>
            {doctors.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="wl-phone"
            className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Patient phone
          </label>
          <input
            id="wl-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Registered patient"
            className={INPUT}
          />
        </div>

        <div>
          <label
            htmlFor="wl-reason"
            className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
          >
            Priority reason
          </label>
          <select
            id="wl-reason"
            value={priorityReason}
            onChange={(e) => setPriorityReason(e.target.value)}
            className={INPUT}
          >
            {PRIORITY_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </div>

        {/* The decision, made explicit rather than implied. Spans the row on
            its own line so neither label is clipped. */}
        <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
          <button
            type="button"
            onClick={() => handleAdd({ thenQueue: false })}
            disabled={busy}
            className={`${PILL} whitespace-nowrap`}
            title="Go on the list and be given a slot when one frees up"
          >
            <Plus weight="bold" className="w-4 h-4" aria-hidden="true" />
            Add to Waiting List
          </button>

          <button
            type="button"
            onClick={() => handleAdd({ thenQueue: true })}
            disabled={busy || vacancies.length === 0}
            className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-slate-300 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition duration-150 disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap"
            title={
              vacancies.length
                ? `Book them straight into ${queueSlot || vacancies[0]}`
                : "No free slot right now"
            }
          >
            Add to Queue
          </button>
        </div>
      </div>

      {/* RECOVERY WINDOW - capacity at the end of the session held for
          whoever is still waiting. Normal appointments outside it are
          untouched. */}
      {doctorId && (
        <div className="mb-5 rounded-xl border border-dashed border-slate-300 dark:border-surface-border p-3.5">
          {recoverySlots.length > 0 ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <p className="text-sm text-slate-700 dark:text-slate-300">
                <span className="font-semibold">Recovery window open:</span>{" "}
                {recoverySlots.join(", ")}
                <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Held for patients still on the list. Patients are never
                  offered these; assign them below.
                </span>
              </p>

              <button
                type="button"
                onClick={handleCloseWindow}
                disabled={busy}
                className="inline-flex items-center h-9 px-4 rounded-full border border-slate-300 dark:border-surface-border text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition duration-150 disabled:opacity-50"
              >
                Close window
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-[9rem]">
                <label
                  htmlFor="wl-window-start"
                  className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  Recovery window from
                </label>
                <select
                  id="wl-window-start"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  className={INPUT}
                >
                  <option value="">Start…</option>
                  {vacancies.map((slot) => (
                    <option key={`ws-${slot}`} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </div>

              <div className="min-w-[9rem]">
                <label
                  htmlFor="wl-window-end"
                  className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
                >
                  until
                </label>
                <select
                  id="wl-window-end"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  className={INPUT}
                >
                  <option value="">End…</option>
                  {vacancies.map((slot) => (
                    <option key={`we-${slot}`} value={slot}>
                      {slot}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="button"
                onClick={handleOpenWindow}
                disabled={busy || !windowStart || !windowEnd}
                className={PILL}
              >
                Open window
              </button>

              <p className="text-xs text-slate-500 dark:text-slate-400 flex-1 min-w-[14rem]">
                The end time is exclusive. Slots already booked inside the
                window keep their patient.
              </p>
            </div>
          )}
        </div>
      )}

      {!doctorId && (
        <p className="mb-4 rounded-xl border border-dashed border-slate-300 dark:border-surface-border px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
          Choose a doctor above to see their free slots and to add patients to
          the queue. Slots belong to one doctor's schedule, so there is nothing
          to assign until one is selected.
        </p>
      )}

      {/* ADD TO QUEUE - pick a waiting patient and a free slot. This is how
          someone moves OFF the waiting list and INTO the clinical queue.
          The patient is chosen from the list itself; reception never has to
          re-type a phone number for someone already sitting in front of
          them. */}
      {doctorId && entries.length > 0 && (
        <div className="mb-4 rounded-xl bg-primary-50/60 dark:bg-primary-500/10 p-3.5">
          <div className="flex flex-wrap items-end gap-3">
            <div className="min-w-[13rem] flex-1 basis-52">
              <label
                htmlFor="wl-queue-patient"
                className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Add to queue — patient
              </label>
              <select
                id="wl-queue-patient"
                aria-label="Waiting patient to add to the queue"
                value={queueEntryId}
                onChange={(e) => setQueueEntryId(e.target.value)}
                className={INPUT}
              >
                <option value="">
                  Next by priority — {entries[0].patientName}
                </option>
                {entries.map((entry, index) => (
                  <option key={entry._id} value={entry._id}>
                    {index + 1}. {entry.patientName}
                    {entry.priority === "High" ? " (high priority)" : ""}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-[12rem] flex-1 basis-48">
              <label
                htmlFor="wl-queue-slot"
                className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                into slot
              </label>
              <select
                id="wl-queue-slot"
                aria-label="Slot to add the waiting patient into"
                value={queueSlot}
                onChange={(e) => setQueueSlot(e.target.value)}
                className={INPUT}
              >
                <option value="">Choose a free slot…</option>
                {vacancies.map((slot) => (
                  <option key={`q-${slot}`} value={slot}>
                    {slot}
                  </option>
                ))}
                {recoverySlots.map((slot) => (
                  <option key={`qr-${slot}`} value={slot}>
                    {slot} — RECOVERY
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              onClick={handleAddToQueue}
              disabled={busy || !queueSlot}
              className={`${PILL} whitespace-nowrap`}
            >
              Add to Queue
            </button>
          </div>

          {vacancies.length + recoverySlots.length === 0 && (
            <p className="text-xs text-slate-600 dark:text-slate-400 mt-2">
              No free slots for this doctor right now. They stay on the list
              until a slot frees up, or open a recovery window below.
            </p>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 dark:border-surface-border px-5 py-8 text-center text-sm text-slate-500">
          Nobody is waiting.
        </p>
      ) : (
        <ol className="space-y-3">
          {entries.map((entry, index) => (
            <li
              key={entry._id}
              className="flex flex-wrap items-start gap-3 rounded-xl border border-slate-200 dark:border-surface-border p-3.5"
            >
              <span className="w-7 h-7 shrink-0 rounded-full bg-slate-100 dark:bg-surface flex items-center justify-center text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">
                {index + 1}
              </span>

              <div className="min-w-0 flex-1">
                {/* break-words, not truncate: a long name should wrap inside
                    the card rather than be cut off or push the actions out. */}
                <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
                  {entry.patientName}
                </p>

                <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                  {/* Why they are on the list - a walk-in and a patient who
                      missed their slot are handled the same way from here,
                      but reception should still be able to tell them apart. */}
                  <span className="inline-flex items-center rounded-full bg-slate-100 dark:bg-surface px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                    {entry.reason}
                  </span>

                  {entry.priority === "High" && (
                    <span className="inline-flex items-center rounded-full bg-danger-50 dark:bg-danger-500/10 px-2 py-0.5 text-[11px] font-semibold text-danger-700 dark:text-danger-400">
                      {entry.priorityReason || "High priority"}
                    </span>
                  )}

                  {/* The list only ever returns Waiting entries - an assigned
                      patient is gone from it the moment they are given a slot
                      - so this badge is a constant. It is shown anyway
                      because "what state is this person in" should be
                      readable off the row rather than inferred from the fact
                      that the row exists at all. */}
                  <span className="inline-flex items-center gap-1 rounded-full bg-warning-50 dark:bg-warning-500/10 px-2 py-0.5 text-[11px] font-semibold text-warning-700 dark:text-warning-400">
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-warning-500"
                      aria-hidden="true"
                    />
                    Waiting
                  </span>

                  {/* Shown only when the list spans doctors, so a
                      doctor-scoped list does not repeat its own heading on
                      every row. */}
                  {!doctorId && entry.doctorId?.name && (
                    <span className="text-[11px] text-slate-500 dark:text-slate-400">
                      {entry.doctorId.name}
                    </span>
                  )}
                </div>
              </div>

              {/* Only offered once a doctor is chosen, because a vacancy
                  belongs to one schedule. */}
              {doctorId &&
              vacancies.length + recoverySlots.length > 0 ? (
                <div className="flex items-center gap-2">
                  <ArrowRight
                    weight="bold"
                    className="w-4 h-4 text-slate-400"
                    aria-hidden="true"
                  />
                  <select
                    aria-label={`Assign a slot to ${entry.patientName}`}
                    defaultValue=""
                    disabled={assigning === entry._id}
                    onChange={(e) => handleAssign(entry, e.target.value)}
                    className={`${INPUT} !w-auto min-w-[9rem] max-w-full`}
                  >
                    <option value="">Assign a slot…</option>
                    {vacancies.map((slot) => (
                      <option key={slot} value={slot}>
                        {slot}
                      </option>
                    ))}
                    {/* The recovery window exists for exactly these patients,
                        so assigning from it is the normal case, not an
                        exception - but it is still labelled. */}
                    {recoverySlots.map((slot) => (
                      <option key={`rec-${slot}`} value={slot}>
                        {slot} — RECOVERY
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                doctorId && (
                  <span className="text-xs text-slate-400">No free slots</span>
                )
              )}

              <button
                type="button"
                onClick={() => handleRemove(entry)}
                aria-label={`Remove ${entry.patientName} from the waiting list`}
                className="shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-slate-400 hover:text-danger-600 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors"
              >
                <X weight="bold" className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

WaitingList.propTypes = {
  doctors: PropTypes.array,
};

export default WaitingList;
