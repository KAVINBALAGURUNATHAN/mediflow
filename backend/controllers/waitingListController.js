const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const WaitingListEntry = require("../models/WaitingListEntry");
const { normalizeToIstDay } = require("../utils/istDay");
const getISTDayRange = require("../utils/getISTDayRange");
const { getDoctorDaySlots } = require("../utils/doctorAvailability");
const BlockedSlot = require("../models/BlockedSlot");
const { saveWithToken } = require("../utils/saveWithToken");
const Settings = require("../models/Settings");
const {
  isLate,
  minutesLate,
  DEFAULT_GRACE_MINUTES,
} = require("../utils/lateness");

// The waiting/vacant list. Reception owns it: they are the ones who can see
// who is physically in the building.
//
// The rule that shapes everything here: A SLOT TIME PASSING IS NOT A NO-SHOW.
// A 10:00 patient arriving at 10:05 while the 09:40 is still being seen has
// not missed anything, and nothing in this file cancels an appointment because
// the clock moved. Only a receptionist marking a no-show frees a slot, because
// only reception knows the patient is not there.

// The list is a backup queue, not a second waiting room - past six people it
// stops being something reception can actually work through, and a patient
// told "you are 11th" has been told nothing useful.
const MAX_WAITING = 6;

// Same ordering as the live queue: priority, then who has been waiting
// longest. Reusing byQueueOrder is not possible (entries have no slot or
// token), so the priority half is reused explicitly and the tiebreak is
// arrival on the list.
const PRIORITY_RANK = { High: 3, Normal: 2, Low: 1 };

function byWaitingOrder(a, b) {
  const rank =
    (PRIORITY_RANK[b.priority] || 2) - (PRIORITY_RANK[a.priority] || 2);
  if (rank !== 0) return rank;
  return new Date(a.addedAt) - new Date(b.addedAt);
}

async function resolveDoctor(doctorId, res) {
  if (!mongoose.Types.ObjectId.isValid(doctorId ?? "")) {
    res.status(400).json({ message: "A valid doctor is required" });
    return null;
  }

  const doctor = await Doctor.findById(doctorId);

  if (!doctor) {
    res.status(404).json({ message: "Doctor not found" });
    return null;
  }

  return doctor;
}

// ===========================
// THE LIST
// ===========================
exports.getWaitingList = async (req, res) => {
  try {
    const today = normalizeToIstDay(new Date());

    const filter = { date: today, status: "Waiting" };

    // Scoped to one doctor when asked, because that is how a vacancy is
    // filled - a slot frees up in one doctor's schedule, not the clinic's.
    if (req.query.doctorId) {
      if (!mongoose.Types.ObjectId.isValid(req.query.doctorId)) {
        return res.status(400).json({ message: "Invalid doctor ID" });
      }
      filter.doctorId = req.query.doctorId;
    }

    const entries = await WaitingListEntry.find(filter)
      .populate("doctorId", "name specialization")
      .lean();

    entries.sort(byWaitingOrder);

    res.status(200).json({
      message: "Waiting list fetched successfully",
      maxWaiting: MAX_WAITING,
      entries,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// ADD TO THE LIST
// ===========================
// Two ways in: a walk-in identified by phone, or an existing appointment whose
// patient is here but has lost their slot. Both end up as the same entry.
exports.addToWaitingList = async (req, res) => {
  try {
    const { doctorId, phone, appointmentId, reason, priority, priorityReason } =
      req.body;

    const today = normalizeToIstDay(new Date());

    let doctor;
    let patient;
    let sourceAppointmentId = null;
    let patientName;
    let patientPhone;
    // What the patient was already booked with. A move must not quietly
    // demote them: a High-priority patient who arrives late is still High
    // priority, and losing that on the way to the list would push them behind
    // everyone else - the opposite of what their priority is for. Reception's
    // button says "with their priority intact", so it has to be.
    let sourcePriority = null;
    let sourcePriorityReason = null;

    if (appointmentId) {
      if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
        return res.status(400).json({ message: "Invalid appointment ID" });
      }

      const appointment = await Appointment.findById(appointmentId);

      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      // A completed visit is over; the patient does not need a second slot.
      if (appointment.status === "Completed") {
        return res.status(400).json({
          message: "That visit is already complete",
        });
      }

      // The patient is WITH THE DOCTOR right now. Moving them to the waiting
      // list releases the slot they are currently using, which cancels the
      // consultation out from under the doctor mid-appointment - and then
      // offers the patient a second one. The patient-cancel path already
      // refuses an in-progress consultation for the same reason.
      if (appointment.status === "In Consultation") {
        return res.status(400).json({
          message:
            "That patient is already with the doctor and cannot be moved to the waiting list",
        });
      }

      // The grace period, enforced server-side. A client cannot decide a
      // patient is late: reception's screen shows the flag, but this is what
      // actually refuses the move, so a stale page or a hand-made request
      // cannot take an on-time patient's slot away from them.
      //
      // Only applied once they have ARRIVED. A patient who has not turned up
      // is overdue, not late-arriving, and the decision there is a no-show -
      // moving somebody who is not in the building would list a patient
      // nobody can hand a vacancy to.
      // ARRIVAL IS REQUIRED. You cannot hand a vacancy to somebody who is not
      // in the building: the waiting list is worked by calling the next
      // person forward, and an entry for a patient who never turned up is one
      // reception would have to skip every time. A patient past their slot
      // and still absent is overdue, and the decision there is a no-show -
      // which frees their slot without promising them another one.
      //
      // This used to be written as `if (appointment.checkedInAt) { ...grace
      // check... }`, so a never-arrived patient skipped the check entirely
      // and the move was ALLOWED - the exact case the comment said it was
      // preventing. Reception's screen never offered it, so only a stale page
      // or a hand-made request could reach it, which is precisely what
      // server-side validation is for.
      if (!appointment.checkedInAt) {
        return res.status(400).json({
          message: `${appointment.patientName} has not checked in. Mark them as a no-show to free their slot.`,
        });
      }

      // The grace period, enforced server-side. A client cannot decide a
      // patient is late: reception's screen shows the flag, but this is what
      // actually refuses the move, so a stale page or a hand-made request
      // cannot take an on-time patient's slot away from them.
      const settings = await Settings.findOne().lean();
      const graceMinutes = settings?.graceMinutes ?? DEFAULT_GRACE_MINUTES;

      if (!isLate(appointment, { graceMinutes })) {
        return res.status(400).json({
          message: `${appointment.patientName} arrived within the ${graceMinutes}-minute grace period and keeps their appointment`,
        });
      }

      doctor = await Doctor.findById(appointment.doctorId);
      patient = appointment.patient;
      patientName = appointment.patientName;
      patientPhone = appointment.phone;
      sourceAppointmentId = appointment._id;
      sourcePriority = appointment.priority;
      sourcePriorityReason = appointment.priorityReason;

      if (!patient) {
        return res.status(400).json({
          message: "That appointment has no patient record attached",
        });
      }

      // MOVING a patient to the waiting list means they give up the slot they
      // could not use. Leaving it held was a real bug, found by the
      // scheduling integration test: the slot stayed blocked so nobody else
      // could have it, AND the patient could never be assigned a new one -
      // the duplicate guard correctly refused them a second live appointment,
      // so they were stuck on the list they had just been moved to.
      //
      // Released with .save() so the pre-save hook clears slotActive, which is
      // what turns it into a vacancy the list can then be worked against. The
      // entry's sourceAppointmentId keeps the two records connected, so this
      // reads as "moved", not as a booking that vanished.
      if (appointment.status !== "Cancelled") {
        appointment.status = "Cancelled";
        appointment.cancelledAt = new Date();
        await appointment.save();
      }
    } else {
      doctor = await resolveDoctor(doctorId, res);
      if (!doctor) return;

      const trimmedPhone = String(phone ?? "").trim();

      if (!trimmedPhone) {
        return res
          .status(400)
          .json({ message: "A phone number is required for a walk-in" });
      }

      // Walk-ins still need a patient record - a result or a prescription has
      // to belong to someone. Registering them is a separate, existing step.
      const found = await Patient.findOne({ phone: trimmedPhone });

      if (!found) {
        return res.status(404).json({
          message:
            "No patient is registered with that phone number. Register them first.",
        });
      }

      patient = found._id;
      patientName = found.name;
      patientPhone = found.phone;
    }

    // Capacity is per doctor per day, checked here rather than in an index
    // because "at most six" is not something a unique index can express.
    // A race could momentarily exceed it; the list is worked by one desk, and
    // a seventh entry is a soft problem where a double-booked slot is not.
    const waiting = await WaitingListEntry.countDocuments({
      doctorId: doctor._id,
      date: today,
      status: "Waiting",
    });

    if (waiting >= MAX_WAITING) {
      return res.status(409).json({
        message: `The waiting list for ${doctor.name} is full (${MAX_WAITING} patients)`,
      });
    }

    const entry = new WaitingListEntry({
      doctorId: doctor._id,
      date: today,
      patient,
      patientName,
      phone: patientPhone,
      reason: reason || (sourceAppointmentId ? "Late arrival" : "Walk-in"),
      // An explicit priority in the request still wins - reception may be
      // raising it as they move the patient - but the appointment's own
      // priority is the fallback, not "Normal".
      priority: priority || sourcePriority || "Normal",
      priorityReason: priorityReason || sourcePriorityReason || "",
      sourceAppointmentId,
      addedBy: req.receptionist.receptionistId,
    });

    await entry.save();

    // Every screen showing this list has just gone stale. It matters most for
    // a MOVE: the patient vanishes from the queue table the instant their slot
    // is released, and without this they do not reappear on the waiting list
    // until someone reloads the page - so for a moment reception has lost a
    // patient who is standing in front of them.
    const io = req.app.get("io");
    if (io) io.emit("queueUpdated", { doctorId: doctor._id });

    res.status(201).json({
      message: `${patientName} added to the waiting list`,
      entry,
    });
  } catch (error) {
    // The partial unique index is what actually prevents the same patient
    // being listed twice for one doctor today.
    if (error.code === 11000) {
      return res.status(409).json({
        message: "That patient is already on this doctor's waiting list",
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid entry",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

// ===========================
// REMOVE FROM THE LIST
// ===========================
// Marked removed, never deleted: that someone waited and then left is part of
// the day's record, and deleting the row would also free the unique index in a
// way that hides a double-add.
exports.removeFromWaitingList = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid waiting list entry ID" });
    }

    const entry = await WaitingListEntry.findById(req.params.id);

    if (!entry) {
      return res.status(404).json({ message: "Waiting list entry not found" });
    }

    if (entry.status === "Assigned") {
      return res.status(400).json({
        message: "That patient has already been given a slot",
      });
    }

    if (entry.status === "Removed") {
      return res.status(200).json({ message: "Already removed", entry });
    }

    entry.status = "Removed";
    entry.removedAt = new Date();
    await entry.save();

    const io = req.app.get("io");
    if (io) io.emit("queueUpdated", { doctorId: entry.doctorId });

    res.status(200).json({ message: "Removed from the waiting list", entry });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// MARK A NO-SHOW
// ===========================
// The ONLY way an appointment becomes a vacancy. Nothing in this application
// cancels a booking because its slot time passed - a patient stuck in traffic
// is late, not absent, and only reception can tell the difference.
exports.markNoShow = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid appointment ID" });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    // Someone who is standing at the desk has not failed to arrive. If they
    // are simply too late for their own slot, they go on the waiting list -
    // that is a different action with a different meaning.
    if (appointment.checkedInAt) {
      return res.status(400).json({
        message:
          "That patient has already checked in. Move them to the waiting list instead.",
      });
    }

    if (appointment.status === "Completed") {
      return res
        .status(400)
        .json({ message: "That visit is already complete" });
    }

    if (appointment.status === "Cancelled") {
      return res
        .status(400)
        .json({ message: "That appointment is already closed" });
    }

    const now = new Date();

    appointment.status = "Cancelled";
    appointment.cancelledAt = now;
    appointment.noShowAt = now;

    // .save() so the pre-save hook clears slotActive - which is precisely what
    // turns this into a bookable vacancy. An updateMany here would leave the
    // slot still held and the vacancy would never appear.
    await appointment.save();

    // A no-show is the ONE thing that creates a vacancy, so this is the
    // broadcast the waiting list exists to react to. Without it the freed
    // slot stays invisible on every screen but the one that made the call -
    // including the waiting-room display and any second desk.
    const io = req.app.get("io");
    if (io) io.emit("queueUpdated", { appointmentId: appointment._id });

    res.status(200).json({
      message: `${appointment.patientName} marked as a no-show; their slot is now free`,
      appointment,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// TODAY'S VACANCIES
// ===========================
// Slots this doctor genuinely has free for the rest of today. Derived from
// getDoctorDaySlots, the single source of truth for "is this slot free" - a
// second opinion here is how double bookings start.
exports.getVacancies = async (req, res) => {
  try {
    const doctor = await resolveDoctor(req.query.doctorId, res);
    if (!doctor) return;

    const { slots, recoverySlots } = await getDoctorDaySlots(
      doctor,
      new Date()
    );

    res.status(200).json({
      message: "Vacancies fetched successfully",
      doctorId: doctor._id,
      // GENUINE vacancies: slots nobody currently holds. A no-show or a
      // cancellation puts a slot back in here, and this is what the waiting
      // list is worked against.
      slots,
      // Recovery-window capacity. Never offered to patients.
      recoverySlots,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// ASSIGN A VACANCY
// ===========================
// Takes the patient off the list and gives them a real appointment in the
// freed slot. Everything about this is duplicate-prevention:
//
//   - the entry must still be "Waiting"      (no double assignment)
//   - the slot must still be free            (no double booking)
//   - the unique slot index is the real guard (no lost race)
//   - the patient must not already hold a live slot today with this doctor
exports.assignVacancy = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid waiting list entry ID" });
    }

    const entry = await WaitingListEntry.findById(req.params.id);

    if (!entry) {
      return res.status(404).json({ message: "Waiting list entry not found" });
    }

    if (entry.status === "Assigned") {
      return res.status(409).json({
        message: "That patient has already been given a slot",
      });
    }

    if (entry.status === "Removed") {
      return res.status(400).json({
        message: "That patient is no longer on the waiting list",
      });
    }

    const slot = String(req.body?.slot ?? "").trim();

    if (!slot) {
      return res.status(400).json({ message: "A slot is required" });
    }

    const doctor = await Doctor.findById(entry.doctorId);

    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    // Asked of the same helper the booking page uses, so reception cannot
    // assign a slot the patient portal would refuse.
    const { slots, recoverySlots } = await getDoctorDaySlots(
      doctor,
      new Date()
    );

    // Recovery capacity is assignable HERE and only here. It is excluded from
    // `slots`, so the patient booking path cannot reach it - which is the
    // entire reason for holding it back.
    const usingRecovery = recoverySlots.includes(slot);

    if (!slots.includes(slot) && !usingRecovery) {
      return res.status(409).json({
        message: "That slot is no longer free",
      });
    }

    const { todayStart, todayEnd } = getISTDayRange(new Date());

    // A patient already holding a live slot with this doctor today does not
    // need a second one, and two appointments for one person on one day is a
    // queue that contradicts itself.
    const existing = await Appointment.findOne({
      doctorId: entry.doctorId,
      patient: entry.patient,
      appointmentDate: { $gte: todayStart, $lte: todayEnd },
      slotActive: true,
    });

    if (existing) {
      return res.status(409).json({
        message: "That patient already has a live appointment today",
      });
    }

    const source = entry.sourceAppointmentId
      ? await Appointment.findById(entry.sourceAppointmentId).lean()
      : null;

    const appointment = new Appointment({
      doctorId: entry.doctorId,
      patient: entry.patient,
      patientName: entry.patientName,
      phone: entry.phone,
      // Carried over from the appointment they lost, so the new booking is not
      // a thinner record than the one it replaces.
      age: source?.age ?? 0,
      gender: source?.gender,
      bloodGroup: source?.bloodGroup,
      medicalConditions: source?.medicalConditions,
      currentMedications: source?.currentMedications,
      symptoms: source?.symptoms || "Assigned from the waiting list",
      appointmentDate: normalizeToIstDay(new Date()),
      slot,
      status: "Waiting",
      priority: entry.priority,
      priorityReason: entry.priorityReason,
    });

    // Through the shared helper, so an assigned patient gets a token exactly
    // like any other booking. Without one they hold the slot but never appear
    // in GET /doctor/live-queue, which filters on tokenNumber - booked, and
    // invisible to the doctor.
    await saveWithToken(Appointment, appointment, new Date());

    // The reservation has done its job. Releasing it now means the slot is
    // simply held by a real appointment, exactly like any other booked slot -
    // rather than being both reserved AND booked, which would leave a stale
    // block behind if that appointment were later cancelled.
    if (usingRecovery) {
      await BlockedSlot.deleteOne({
        doctorId: entry.doctorId,
        date: normalizeToIstDay(new Date()),
        slot,
        isRecovery: true,
      });
    }

    entry.status = "Assigned";
    entry.assignedAt = new Date();
    entry.assignedAppointmentId = appointment._id;
    await entry.save();

    const io = req.app.get("io");
    if (io) {
      io.emit("queueUpdated", { appointmentId: appointment._id });
    }

    res.status(201).json({
      message: `${entry.patientName} assigned to ${slot}`,
      appointment,
      entry,
    });
  } catch (error) {
    // The partial unique index on {doctorId, appointmentDate, slot} filtered
    // by slotActive is the real guard against two people being given the same
    // vacancy - two receptionists clicking at once lose the race here, not in
    // the availability check above.
    if (error.code === 11000) {
      return res.status(409).json({
        message: "That slot was taken while you were assigning it",
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid assignment",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

// Exported for the tests, which assert the ordering rule directly rather than
// inferring it from a response.
exports.byWaitingOrder = byWaitingOrder;
exports.MAX_WAITING = MAX_WAITING;


// ===========================
// RECOVERY WINDOW
// ===========================
// A period at the end of a session held for patients still on the waiting
// list:
//
//   8 AM - 12 PM   normal appointments   (protected - untouched by this)
//   12 PM - 1 PM   recovery window       (waiting-list patients only)
//
// Built out of the BlockedSlot mechanism, one block per slot in
// the range. That is what keeps it out of the patient booking path for free,
// and it is why there is no second appointment system here: a recovery
// appointment is an ordinary Appointment in an ordinary slot, created through
// the same assignVacancy path as any other.

// "hh:mm AM/PM" -> minutes since midnight. The slot labels generateSlots
// produces are the only format in play, and BlockedSlot validates it too.
function slotToMinutes(slot) {
  const [time, meridiem] = String(slot).split(" ");
  let [hours, minutes] = time.split(":").map(Number);

  if (meridiem?.toUpperCase() === "PM" && hours !== 12) hours += 12;
  if (meridiem?.toUpperCase() === "AM" && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

exports.openRecoveryWindow = async (req, res) => {
  try {
    const doctor = await resolveDoctor(req.body?.doctorId, res);
    if (!doctor) return;

    const start = String(req.body?.start ?? "").trim();
    const end = String(req.body?.end ?? "").trim();

    if (!start || !end) {
      return res
        .status(400)
        .json({ message: "A start and end time are required" });
    }

    const startMinutes = slotToMinutes(start);
    const endMinutes = slotToMinutes(end);

    if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) {
      return res.status(400).json({
        message: "Times must look like '12:00 PM'",
      });
    }

    if (endMinutes <= startMinutes) {
      return res
        .status(400)
        .json({ message: "The window must end after it starts" });
    }

    const { slots } = await getDoctorDaySlots(doctor, new Date());

    // Only slots that are genuinely free may be held. A patient who already
    // booked inside the window keeps their appointment - the window protects
    // remaining capacity, it never takes back capacity someone has.
    const inWindow = slots.filter((slot) => {
      const minutes = slotToMinutes(slot);
      return minutes >= startMinutes && minutes < endMinutes;
    });

    if (inWindow.length === 0) {
      return res.status(409).json({
        message: "No free slots remain in that window",
      });
    }

    const today = normalizeToIstDay(new Date());

    await BlockedSlot.insertMany(
      inWindow.map((slot) => ({
        doctorId: doctor._id,
        date: today,
        slot,
        isFullDay: false,
        isRecovery: true,
        reason: "Recovery window",
      }))
    );

    const io = req.app.get("io");
    if (io) io.emit("queueUpdated", { doctorId: doctor._id });

    res.status(201).json({
      message: `Recovery window open: ${inWindow.join(", ")}`,
      recoverySlots: inWindow,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Part of that window is already held or blocked",
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message:
          Object.values(error.errors)[0]?.message || "Invalid recovery window",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

// Closes the window, returning whatever is left of it to ordinary booking -
// so unused recovery capacity is not wasted.
exports.closeRecoveryWindow = async (req, res) => {
  try {
    const doctor = await resolveDoctor(
      req.query.doctorId || req.body?.doctorId,
      res
    );
    if (!doctor) return;

    const filter = {
      doctorId: doctor._id,
      date: normalizeToIstDay(new Date()),
      isRecovery: true,
    };

    const held = await BlockedSlot.find(filter).select("slot").lean();

    if (held.length === 0) {
      return res.status(404).json({
        message: "No recovery window is open for that doctor today",
      });
    }

    await BlockedSlot.deleteMany(filter);

    const io = req.app.get("io");
    if (io) io.emit("queueUpdated", { doctorId: doctor._id });

    res.status(200).json({
      message: "Recovery window closed",
      released: held.map((b) => b.slot),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};


// ===========================
// ASSIGN THE NEXT PATIENT
// ===========================
// Gives a freed slot to whoever is actually at the front of the list -
// priority first, then longest waiting - rather than to whoever reception
// happens to click.
//
// The list was already ORDERED by that rule, but ordering a list is only a
// suggestion: nothing stopped a Normal-priority patient being assigned while
// an Emergency sat above them. This makes the rule the default action, and it
// is the one reception should use for an ordinary vacancy. Assigning a
// specific entry stays available for the cases that genuinely need judgement
// (the patient has left, or is not fit to be seen next).
exports.assignNextWaiting = async (req, res) => {
  try {
    const doctor = await resolveDoctor(req.body?.doctorId, res);
    if (!doctor) return;

    const slot = String(req.body?.slot ?? "").trim();

    if (!slot) {
      return res.status(400).json({ message: "A slot is required" });
    }

    const entries = await WaitingListEntry.find({
      doctorId: doctor._id,
      date: normalizeToIstDay(new Date()),
      status: "Waiting",
    });

    if (entries.length === 0) {
      return res.status(404).json({
        message: "Nobody is on the waiting list for that doctor",
      });
    }

    // Same comparator the list is rendered with, so what reception sees at
    // the top is exactly who gets the slot.
    entries.sort(byWaitingOrder);

    // Delegated to the single assignment path rather than duplicated: every
    // duplicate-prevention rule (slot still free, entry still waiting,
    // patient not already booked today, the unique index) applies unchanged.
    req.params = { ...req.params, id: String(entries[0]._id) };
    req.body = { ...req.body, slot };

    return exports.assignVacancy(req, res);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
