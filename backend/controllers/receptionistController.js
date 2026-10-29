const Receptionist = require("../models/Receptionist");
const Appointment = require("../models/Appointment");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { getDateRangeFilter } = require("../utils/getDateRangeFilter");
const { byQueueOrder } = require("../utils/queueOrder");
const Settings = require("../models/Settings");
const {
  minutesLate,
  isLate,
  isLateArrival,
  isOverdue,
  DEFAULT_GRACE_MINUTES,
} = require("../utils/lateness");

// ===================================
// VALIDATION HELPERS
// ===================================
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (email) => {
  return emailRegex.test(email.toLowerCase().trim());
};

// ===================================
// HELPER: TODAY DATE RANGE (IST OFFSET)
// ===================================
const getTodayRange = () => {
  const IST_OFFSET = 5.5 * 60 * 60 * 1000;

  // Base date from current UTC time
  const baseDate = new Date();
  const currentIstTime = new Date(baseDate.getTime() + IST_OFFSET);

  // Build clean calendar day limits in local IST
  const startOfIstDay = new Date(currentIstTime);
  startOfIstDay.setUTCHours(0, 0, 0, 0);

  const endOfIstDay = new Date(currentIstTime);
  endOfIstDay.setUTCHours(23, 59, 59, 999);

  // Convert back to base UTC timestamps for database queries
  return {
    startOfToday: new Date(startOfIstDay.getTime() - IST_OFFSET),
    endOfToday: new Date(endOfIstDay.getTime() - IST_OFFSET)
  };
};

// ===========================
// RECEPTIONIST LOGIN
// ===========================
exports.receptionistLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    // Validate Email Format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: "Invalid email format",
      });
    }

    const receptionist = await Receptionist.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");

    if (!receptionist) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(
      password,
      receptionist.password
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT secret is not configured",
      });
    }

    const token = jwt.sign(
      {
        receptionistId: receptionist._id,
        email: receptionist.email,
        role: "receptionist",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      receptionist: {
        _id: receptionist._id,
        name: receptionist.name,
        email: receptionist.email,
        role: "receptionist",
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
// ===========================
// RECEPTIONIST PROFILE
// ===========================
exports.profile = async (req, res) => {
  try {
    // Token payload is { receptionistId, email, role } - there is no
    // `_id` field on the decoded JWT itself.
    const receptionist = await Receptionist.findById(
      req.receptionist.receptionistId
    ).select("-password");

    if (!receptionist) {
      return res.status(404).json({
        message: "Receptionist not found",
      });
    }

    res.status(200).json({
      receptionist,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// GET TODAY'S APPOINTMENTS
// (optionally ?scope=upcoming for today + the next 30 days, so the
// receptionist dashboard can show Tomorrow/Future sections - default
// behavior with no query param is unchanged: today only.)
// ===========================
exports.getAppointments = async (req, res) => {
  try {
    const { startOfToday, endOfToday } = getTodayRange();

    let dateFilter = { $gte: startOfToday, $lte: endOfToday };

    if (req.query.scope === "upcoming") {
      const horizonEnd = new Date(startOfToday);
      horizonEnd.setDate(horizonEnd.getDate() + 30);
      horizonEnd.setHours(23, 59, 59, 999);
      dateFilter = { $gte: startOfToday, $lte: horizonEnd };
    }

    if (req.query.range || req.query.startDate || req.query.endDate) {
      try {
        const filter = getDateRangeFilter({
          range: req.query.range,
          startDate: req.query.startDate,
          endDate: req.query.endDate,
        });

        if (filter) {
          dateFilter = filter;
        }
      } catch (rangeError) {
        return res.status(400).json({
          message: rangeError.message,
        });
      }
    }

    const appointments = await Appointment.find({
      appointmentDate: dateFilter,
      // Matches Appointment.js's actual status enum:
      // ["Waiting", "In Consultation", "Completed", "Cancelled"].
      // A freshly booked, not-yet-checked-in appointment already
      // defaults to "Waiting", so no separate "Scheduled" state exists
      // to filter on here.
      status: {
        $in: [
          "Waiting",
          "In Consultation",
          "Completed",
        ],
      },
    })
      // Diagnosis/prescription/notes are confidential medical records -
      // receptionists only need operational data (token, status, doctor,
      // time), so these are excluded at the query level, not just hidden
      // in the UI.
      .select("-diagnosis -prescription -notes")
      .populate("doctorId", "name specialization")
      .sort({
        appointmentDate: 1,
      });

    // Priority ordering is applied WITHIN each day, not across the whole
    // result: this list can span a date range, and a High-priority patient
    // from an earlier date must not jump ahead of today's queue. Sorting
    // happens here rather than in the query because MongoDB would order the
    // priority strings alphabetically ("High" < "Low" < "Normal"), which is
    // not the intended ranking.
    const dayOf = (appointment) =>
      appointment.appointmentDate
        ? new Date(appointment.appointmentDate).toISOString().slice(0, 10)
        : "";

    appointments.sort((a, b) => {
      const dayDiff = dayOf(a).localeCompare(dayOf(b));
      if (dayDiff !== 0) return dayDiff;
      return byQueueOrder(a, b);
    });

    // Lateness is computed here rather than stored, because it is a fact
    // about the clock, not a state the patient is in - storing it would mean
    // something had to keep it up to date, and that something would sooner or
    // later "helpfully" act on it. Nothing in this application does.
    const settings = await Settings.findOne().lean();
    const graceMinutes = settings?.graceMinutes ?? DEFAULT_GRACE_MINUTES;
    const now = new Date();

    const withLateness = appointments.map((appointment) => {
      const plain = appointment.toObject ? appointment.toObject() : appointment;

      return {
        ...plain,
        // Arrived after the grace period: the ONLY case where offering to
        // move someone to the waiting list makes sense.
        isLateArrival: isLateArrival(plain, { graceMinutes, now }),
        // Past their slot and still not here. Reception sees it; nothing acts
        // on it. A no-show stays a separate, deliberate decision.
        isOverdue: isOverdue(plain, { graceMinutes, now }),
        minutesLate: minutesLate(plain, now),
        // Sent so the screen can stop asking a question reception already
        // answered. Derived here rather than in the browser so every client
        // agrees on what "already decided" means.
        lateDecision: plain.keptInQueueAt ? "KeptInQueue" : null,
      };
    });

    res.status(200).json({
      appointments: withLateness,
      graceMinutes,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// CHECK IN PATIENT
// ===========================
exports.checkIn = async (req, res) => {
  try {
    const { id } = req.params;
    const { priority = "Normal", priorityReason = "" } = req.body;

    // Vitals are deliberately NOT accepted here. Check-in is an arrival
    // record; height, weight, blood pressure and the rest are a clinical
    // measurement, and clinical measurement is the nurse's job (see
    // nurseController.recordVitals). Any vitals field in this body is ignored
    // rather than rejected, so an older client that still sends them checks
    // the patient in instead of failing.

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    // Matches Appointment.js's actual priority enum: ["High","Normal","Low"]
    const allowedPriorities = ["High", "Normal", "Low"];

    if (!allowedPriorities.includes(priority)) {
      return res.status(400).json({
        message: "Invalid priority",
      });
    }

    // Matches Appointment.js's actual priorityReason enum.
    const allowedReasons = ["", "Senior Citizen", "Emergency", "Pregnant", "Disabled"];

    if (!allowedReasons.includes(priorityReason)) {
      return res.status(400).json({
        message: "Invalid priority reason",
      });
    }

    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    if (appointment.status === "Cancelled") {
      return res.status(400).json({
        message: "Cancelled appointments cannot be checked in",
      });
    }

    const { startOfToday, endOfToday } = getTodayRange();

    const appointmentDate = new Date(
      appointment.appointmentDate
    );

    if (
      appointmentDate < startOfToday ||
      appointmentDate > endOfToday
    ) {
      return res.status(400).json({
        message:
          "Only today's appointments can be checked in",
      });
    }

    // "Already checked in" is now keyed on checkedInAt, not on the token.
    // Booking assigns a token up front (so the patient is visible in the
    // queue immediately), so a present tokenNumber no longer means the
    // patient has physically arrived - only checkedInAt does.
    if (appointment.checkedInAt) {
      return res.status(400).json({
        message: "Patient is already checked in",
      });
    }

    // Older appointments booked before tokens were issued at booking time
    // still arrive here without one, so keep assigning in that case.
    if (appointment.tokenNumber == null) {
      const lastTokenAppointment =
        await Appointment.findOne({
          doctorId: appointment.doctorId,
          appointmentDate: {
            $gte: startOfToday,
            $lte: endOfToday,
          },
          tokenNumber: {
            $ne: null,
          },
        }).sort({
          tokenNumber: -1,
        });

      appointment.tokenNumber = lastTokenAppointment
        ? lastTokenAppointment.tokenNumber + 1
        : 1;
    }
    appointment.priorityReason = priorityReason;
    appointment.priority = priorityReason ? "High" : priority;
    appointment.status = "Waiting";
    appointment.checkedInAt = new Date();

    await appointment.save();

    const io = req.app.get("io");

    if (io) {
      io.emit("queueUpdated", {
        appointmentId: appointment._id,
        doctorId: appointment.doctorId,
        tokenNumber: appointment.tokenNumber,
        status: appointment.status,
        event: "checked-in",
      });
    }

    res.status(200).json({
      message: "Patient checked in successfully",
      appointment: {
        _id: appointment._id,
        patientName: appointment.patientName,
        doctorId: appointment.doctorId,
        tokenNumber: appointment.tokenNumber,
        priority: appointment.priority,
        priorityReason: appointment.priorityReason,
        status: appointment.status,
        slot: appointment.slot,
        appointmentDate: appointment.appointmentDate,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
// ===========================
// CHANGE PASSWORD
// ===========================
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required",
      });
    }

    // Token payload is { receptionistId, email, role } - there is no
    // `_id` field on the decoded JWT itself.
    const receptionist = await Receptionist.findById(req.receptionist.receptionistId);

    if (!receptionist) {
      return res.status(404).json({
        message: "Receptionist not found",
      });
    }

    const isMatch = await bcrypt.compare(
      currentPassword,
      receptionist.password
    );

    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    receptionist.password = await bcrypt.hash(newPassword, 10);

    await receptionist.save();

    res.status(200).json({
      message: "Password changed successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
// ===========================
// RECEPTIONIST DASHBOARD
// ===========================
exports.dashboard = async (req, res) => {
  try {
    const { startOfToday, endOfToday } = getTodayRange();

    const totalAppointments = await Appointment.countDocuments({
      appointmentDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
    });

    const waitingPatients = await Appointment.countDocuments({
      appointmentDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
      status: "Waiting",
    });

    const inConsultation = await Appointment.countDocuments({
      appointmentDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
      status: "In Consultation",
    });

    const completedAppointments = await Appointment.countDocuments({
      appointmentDate: {
        $gte: startOfToday,
        $lte: endOfToday,
      },
      status: "Completed",
    });

    res.status(200).json({
      totalAppointments,
      waitingPatients,
      inConsultation,
      completedAppointments,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
// ===========================
// UPDATE PRIORITY
// ===========================
exports.updatePriority = async (req, res) => {
  try {
    const { id } = req.params;
    const { priority, priorityReason } = req.body;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    // Matches Appointment.js's actual priority enum: ["High","Normal","Low"]
    const allowedPriorities = ["High", "Normal", "Low"];

    if (!allowedPriorities.includes(priority)) {
      return res.status(400).json({
        message: "Invalid priority",
      });
    }

    // Matches Appointment.js's actual priorityReason enum.
    const allowedReasons = ["", "Senior Citizen", "Emergency", "Pregnant", "Disabled"];

    if (priorityReason !== undefined && !allowedReasons.includes(priorityReason)) {
      return res.status(400).json({
        message: "Invalid priority reason",
      });
    }

    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    if (priorityReason !== undefined) {
      appointment.priorityReason = priorityReason;
    }

    // A reason (Senior Citizen/Emergency/Pregnant/Disabled) always implies
    // High priority - that's the entire point of tagging someone with one.
    // Clearing the reason back to "" leaves the priority tier as whatever
    // was explicitly requested (still validated above), so staff can still
    // manually set High/Normal/Low with no reason attached.
    appointment.priority =
      priorityReason && priorityReason !== "" ? "High" : priority;

    await appointment.save();

    const io = req.app.get("io");

    if (io) {
      io.emit("queueUpdated", {
        appointmentId: appointment._id,
        doctorId: appointment.doctorId,
        status: appointment.status,
        event: "priority-updated",
      });
    }

    res.status(200).json({
      message: "Priority updated successfully",
      appointment,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
// ===========================
// GET APPOINTMENT BY ID
// ===========================
exports.getAppointmentById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const appointment = await Appointment.findById(id)
      .select("-diagnosis -prescription -notes")
      .populate("doctorId", "name specialization");

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    res.status(200).json({
      appointment,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};
// ===========================
// CANCEL APPOINTMENT
// ===========================
// ===========================
// KEEP A LATE PATIENT IN THE QUEUE
// ===========================
// The other half of the late-arrival decision. "Move to waiting list" gives
// the slot up; this keeps it.
//
// It deliberately changes NOTHING about the queue - not the status, not the
// slot, not the priority, not the position. A patient who is kept is in
// exactly the state they were in a moment earlier, because that IS the
// decision: the doctor is running behind anyway, or six minutes does not
// matter today, so leave them alone.
//
// What it records is that a human looked. Without it, "reception decided to
// keep this patient" and "reception has not seen this patient yet" render
// identically, so the row goes on asking a question that has been answered
// and no record exists that anyone answered it.
exports.keepInQueue = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid appointment ID" });
    }

    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (appointment.status === "Completed") {
      return res.status(400).json({ message: "That visit is already complete" });
    }

    if (appointment.status === "Cancelled") {
      return res
        .status(400)
        .json({ message: "That appointment is already closed" });
    }

    // Already with the doctor, so there is no queue decision left to make.
    if (appointment.status === "In Consultation") {
      return res.status(400).json({
        message: "That patient is already with the doctor",
      });
    }

    // Arrival is required for the same reason the move requires it: this is a
    // decision about somebody standing at the desk. A patient who has not
    // turned up is overdue, and that decision is a no-show.
    if (!appointment.checkedInAt) {
      return res.status(400).json({
        message: `${appointment.patientName} has not checked in yet`,
      });
    }

    const settings = await Settings.findOne().lean();
    const graceMinutes = settings?.graceMinutes ?? DEFAULT_GRACE_MINUTES;

    // Refused inside the grace period - not because it would do any harm,
    // but because there is nothing to decide. A patient who arrived on time
    // is in the normal queue already, and recording a "decision" to leave
    // them there would put a late-arrival note on a punctual patient's
    // record.
    if (!isLate(appointment, { graceMinutes })) {
      return res.status(400).json({
        message: `${appointment.patientName} arrived within the ${graceMinutes}-minute grace period and is already in the normal queue`,
      });
    }

    // Idempotent: pressing it twice must not move the timestamp, the same way
    // the nurse's hand-off does not.
    if (!appointment.keptInQueueAt) {
      appointment.keptInQueueAt = new Date();
      await appointment.save();
    }

    const io = req.app.get("io");
    if (io) {
      io.emit("queueUpdated", { appointmentId: appointment._id });
    }

    res.status(200).json({
      message: `${appointment.patientName} keeps their place in the queue`,
      appointment,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.cancelAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const appointment = await Appointment.findById(id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    // Matches the same rule already enforced on the doctor-facing update
    // endpoint (PATCH /appointments/:id) - a completed consultation already
    // has a real medical record (diagnosis/prescription) attached to it.
    // Cancelling it would silently erase that from the patient's view
    // (sanitizeAppointmentForPatient only shows it while status is
    // "Completed") without actually deleting anything, which is worse than
    // just rejecting the action outright.
    if (appointment.status === "Completed") {
      return res.status(400).json({
        message: "Completed appointments cannot be cancelled",
      });
    }

    appointment.status = "Cancelled";
    appointment.cancelledAt = new Date();

    await appointment.save();

    const io = req.app.get("io");

    if (io) {
      io.emit("queueUpdated", {
        appointmentId: appointment._id,
        doctorId: appointment.doctorId,
        status: appointment.status,
        event: "cancelled",
      });
    }

    res.status(200).json({
      message: "Appointment cancelled successfully",
      appointment,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Vitals are not a receptionist endpoint. They used to be recorded here at
// check-in and corrected through PATCH /receptionist/appointments/:id/vitals;
// both moved to the nurse, who takes the measurement. See nurseController.
