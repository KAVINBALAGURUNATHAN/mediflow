const Appointment = require("../models/Appointment");
const BlockedSlot = require("../models/BlockedSlot");
const generateSlots = require("./generateSlots");
const getISTDayRange = require("./getISTDayRange");

// Must stay in sync with models/Doctor.js's workingDays schema default.
// Duplicated here (rather than imported from the model) because this is a
// plain fallback constant, not a model concern, and importing it back from
// Doctor.js would be an unnecessary coupling for a 6-item literal array.
const DEFAULT_WORKING_DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Slots available for one specific calendar day, honoring booked
// appointments, blocked slots / full-day leave, and (for today only)
// already-past-time slots. This mirrors the exact logic that used to live
// inline in the GET /doctors/:id/slots route in server.js - both that route
// and the new next-available-slot search below now share this single
// implementation, so they can never drift out of agreement.
//
// The day boundaries MUST come from utils/getISTDayRange.js, never from
// setHours: appointmentDate and BlockedSlot.date are both stored at IST
// midnight expressed in UTC, while setHours resolves in the server process's
// timezone. Those two agree on an IST machine and disagree on a UTC one, so
// a setHours range silently queried the wrong calendar day in production -
// booked and blocked slots were not filtered out of the list at all, and the
// neighbouring day's bookings were filtered out instead.
async function getDoctorDaySlots(doctor, dateObj) {
  if (
    !doctor.workingHours?.start ||
    !doctor.workingHours?.end ||
    !doctor.slotDuration
  ) {
    return {
      slots: [],
      recoverySlots: [],
      totalSlots: 0,
      fullDayBlocked: false,
    };
  }

  const allSlots = generateSlots(
    doctor.workingHours.start,
    doctor.workingHours.end,
    doctor.slotDuration
  );

  const { todayStart: dayStart, todayEnd: dayEnd } = getISTDayRange(dateObj);

  const bookedAppointments = await Appointment.find({
    doctorId: doctor._id,
    appointmentDate: { $gte: dayStart, $lte: dayEnd },
    status: { $ne: "Cancelled" },
  }).select("slot");

  const bookedSlots = new Set(bookedAppointments.map((a) => a.slot));

  const blockedSlotsData = await BlockedSlot.find({
    doctorId: doctor._id,
    date: { $gte: dayStart, $lte: dayEnd },
  });

  const fullDayBlocked = blockedSlotsData.some((b) => b.isFullDay);

  if (fullDayBlocked) {
    return {
      slots: [],
      recoverySlots: [],
      totalSlots: allSlots.length,
      fullDayBlocked: true,
    };
  }

  const blockedSlots = new Set(
    blockedSlotsData.filter((b) => !b.isFullDay).map((b) => b.slot)
  );

  // The recovery window: a run of slots held for patients still on the
  // waiting list. Same mechanism as flex - inside `blockedSlots`, so the
  // public booking path cannot reach one - reported separately so reception
  // can assign from it.
  const recoverySlots = blockedSlotsData
    .filter((b) => !b.isFullDay && b.isRecovery)
    .map((b) => b.slot);

  const now = new Date();
  // Same reasoning as the day boundaries above: compare IST day starts rather
  // than server-local calendar dates, so "is this today?" means the same
  // thing on a UTC host as it does on an IST one.
  const isToday =
    dayStart.getTime() === getISTDayRange(now).todayStart.getTime();

  const slots = allSlots.filter((slot) => {
    if (bookedSlots.has(slot) || blockedSlots.has(slot)) return false;

    if (isToday) {
      const [time, meridiem] = slot.split(" ");
      let [hours, minutes] = time.split(":").map(Number);

      if (meridiem.toUpperCase() === "PM" && hours !== 12) hours += 12;
      if (meridiem.toUpperCase() === "AM" && hours === 12) hours = 0;

      // dayStart is IST midnight as a UTC instant, so adding the slot's
      // IST wall-clock offset gives the slot's real instant on any host.
      const slotTime =
        dayStart.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000;
      return slotTime > now.getTime();
    }

    return true;
  });

  // A flex slot in the past is no more usable than any other past slot, so it
  // is filtered by the same clock rule the open slots use.
  //
  // The expired ones are reported SEPARATELY rather than simply dropped. A
  // reservation that has gone by is invisible but still occupies the one
  // flex-per-doctor-per-day index: reception saw "none held", tried to hold a
  // new one, and got a duplicate-key error from something they could not see.
  // Surfacing it is what lets that be released instead of being a dead end.
  const isPast = (slot) => {
    if (!isToday) return false;

    const [time, meridiem] = slot.split(" ");
    let [hours, minutes] = time.split(":").map(Number);

    if (meridiem.toUpperCase() === "PM" && hours !== 12) hours += 12;
    if (meridiem.toUpperCase() === "AM" && hours === 12) hours = 0;

    const slotTime =
      dayStart.getTime() + hours * 60 * 60 * 1000 + minutes * 60 * 1000;
    return slotTime <= now.getTime();
  };

  // A recovery slot whose time has gone is no more usable than any other past
  // slot, so it is filtered by the same clock rule.
  const usableRecoverySlots = recoverySlots.filter((slot) => !isPast(slot));

  return {
    slots,
    // NOT part of `slots` - patients are never offered these. Assignable
    // only by reception, from the waiting list.
    recoverySlots: usableRecoverySlots,
    totalSlots: allSlots.length,
    fullDayBlocked: false,
  };
}

function formatSlotLabel(daysAhead, dateObj, slot) {
  if (daysAhead === 0) return `Today • ${slot}`;
  if (daysAhead === 1) return `Tomorrow • ${slot}`;
  const label = dateObj.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
  });
  return `${label} • ${slot}`;
}

// Computes the three availability values doctor cards/profiles need, in a
// single forward search so day 0 (today) only needs to be queried once:
//  - nextAvailableSlot: "Today • 3:30 PM" / "Tomorrow • 10:00 AM" /
//    "23 Jul • 9:00 AM", or "No slots available" if nothing found within
//    the search horizon.
//  - remainingSlotsToday: count of bookable slots left today specifically.
//  - availabilityStatus: "UNAVAILABLE" (doctor toggled off), "LIMITED"
//    (few slots left today), or "AVAILABLE".
// Bounded to a 14-day horizon so a fully-booked doctor doesn't trigger an
// unbounded day-by-day scan.
const HORIZON_DAYS = 14;
const LIMITED_THRESHOLD = 3;

async function computeDoctorAvailability(doctor, workingDays) {
  if (!doctor.isAvailable) {
    return {
      nextAvailableSlot: "No slots available",
      remainingSlotsToday: 0,
      availabilityStatus: "UNAVAILABLE",
    };
  }

  const days = workingDays?.length ? workingDays : DEFAULT_WORKING_DAYS;

  let remainingSlotsToday = 0;
  let nextAvailableSlot = "No slots available";

  for (let i = 0; i <= HORIZON_DAYS; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);

    // Weekday of the IST day, not of the server's local day - at 20:00 UTC
    // it is already the next day in IST, and getDay() would name the wrong one.
    const { todayStart } = getISTDayRange(date);
    const dayName =
      WEEKDAY_NAMES[new Date(todayStart.getTime() + IST_OFFSET).getUTCDay()];
    if (!days.includes(dayName)) continue;

    const { slots } = await getDoctorDaySlots(doctor, date);

    if (i === 0) {
      remainingSlotsToday = slots.length;
    }

    if (slots.length > 0) {
      nextAvailableSlot = formatSlotLabel(i, date, slots[0]);
      break;
    }
  }

  const availabilityStatus =
    remainingSlotsToday > LIMITED_THRESHOLD ? "AVAILABLE" : "LIMITED";

  return { nextAvailableSlot, remainingSlotsToday, availabilityStatus };
}

module.exports = {
  DEFAULT_WORKING_DAYS,
  getDoctorDaySlots,
  computeDoctorAvailability,
};
