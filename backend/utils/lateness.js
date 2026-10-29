const { slotToMinutes } = require("./queueOrder");
const { normalizeToIstDay } = require("./istDay");
const getISTDayRange = require("./getISTDayRange");

// The 5-minute grace period.
//
//   arrives at or before T+5  -> keeps their normal appointment and queue
//                                position, exactly as if on time
//   arrives after T+5         -> ELIGIBLE for the waiting-list workflow
//
// Read "eligible" literally. Being late has NO automatic consequence: this
// file does not cancel, does not release a slot, does not reorder the queue
// and does not move anybody. It answers one question - "is this patient past
// the grace period?" - so reception can make the decision they already own.
// Every action remains a deliberate human one.
//
// It is also NOT a no-show rule. A patient who has not arrived is overdue,
// not absent; only a receptionist marking a no-show frees their slot.
const DEFAULT_GRACE_MINUTES = 5;

// The real instant the appointment's slot falls on.
//
// Built from the appointment's OWN day plus the slot's wall-clock offset,
// rather than comparing minutes-since-midnight on both sides. Comparing bare
// wall-clock minutes had two failure modes, both found by probing:
//
//   - an 11:40 PM slot checked at 00:10 the next morning came out as
//     -1410 minutes, i.e. "not late", for a patient half an hour overdue
//   - a checkedInAt from a different day read as though it were today, so a
//     stale record reported a nonsense grace decision
//
// Anchoring to the day removes both: the arithmetic is done on real instants,
// so it cannot wrap.
//
// `appointmentDate` is stored at IST midnight. When it is missing - a plain
// object in a test, say - the reference instant's own IST day is used, which
// is correct for the ordinary "today's appointment" case.
function slotInstant(appointment, reference) {
  const dayStart = appointment.appointmentDate
    ? normalizeToIstDay(appointment.appointmentDate)
    : getISTDayRange(reference).todayStart;

  return dayStart.getTime() + slotToMinutes(appointment.slot) * 60 * 1000;
}

/**
 * How many minutes past their slot the patient is.
 *
 * Measured against ARRIVAL once they have arrived, and against the clock
 * while they have not. That distinction is the whole rule: someone who walked
 * in at 09:03 is three minutes late forever, however long they then sit in
 * the waiting room, and must not drift past the grace period just because the
 * doctor is running behind.
 *
 * The slot is an IST wall-clock label ("09:00 AM") while the timestamps are
 * real instants, so the slot is resolved to an instant on the appointment's
 * own day (see slotInstant). Comparing with the server's local clock would be
 * wrong on a UTC host - the bug this codebase has shipped twice.
 *
 * Negative when the slot has not come round yet.
 */
function minutesLate(appointment, now = new Date()) {
  if (!appointment?.slot) return null;

  const reference = appointment.checkedInAt
    ? new Date(appointment.checkedInAt)
    : now;

  return Math.round(
    (reference.getTime() - slotInstant(appointment, reference)) / (60 * 1000)
  );
}

function graceOf(graceMinutes) {
  return Number.isFinite(graceMinutes) ? graceMinutes : DEFAULT_GRACE_MINUTES;
}

/**
 * Past the grace period?
 *
 * STRICTLY greater than: arriving at exactly T+5 is still within grace, which
 * is what "at or before T + 5 minutes" means. Off-by-one here is the
 * difference between a patient keeping their appointment and losing it.
 *
 * Only meaningful for a visit that is still open - a completed or cancelled
 * appointment has nothing left to be late for.
 */
function isLate(appointment, { graceMinutes, now = new Date() } = {}) {
  if (!appointment) return false;
  if (appointment.status !== "Waiting") return false;

  const late = minutesLate(appointment, now);

  return late !== null && late > graceOf(graceMinutes);
}

/**
 * Late AND actually here - the only case where moving someone to the waiting
 * list makes sense. You cannot hand a vacancy to a patient who is not in the
 * building; if they have not arrived, the decision is a no-show, not a move.
 */
function isLateArrival(appointment, options = {}) {
  return Boolean(appointment?.checkedInAt) && isLate(appointment, options);
}

/**
 * Past their slot and still not here. Reception should see this - it is what
 * a no-show decision is eventually made from - but it is NOT a no-show by
 * itself, and nothing acts on it.
 */
function isOverdue(appointment, options = {}) {
  return !appointment?.checkedInAt && isLate(appointment, options);
}

module.exports = {
  DEFAULT_GRACE_MINUTES,
  minutesLate,
  isLate,
  isLateArrival,
  isOverdue,
};
