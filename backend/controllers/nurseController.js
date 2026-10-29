const Nurse = require("../models/Nurse");
const Appointment = require("../models/Appointment");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const { parseVitals, isEmptyVitals } = require("../utils/parseVitals");
const getISTDayRange = require("../utils/getISTDayRange");
const { byQueueOrder } = require("../utils/queueOrder");

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (email) =>
  emailRegex.test(String(email).toLowerCase().trim());

// ===========================
// LOGIN
// ===========================
exports.nurseLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const nurse = await Nurse.findOne({
      email: String(email).toLowerCase().trim(),
    }).select("+password");

    // The same message for an unknown email and a wrong password, so the
    // response cannot be used to discover which staff emails exist. Matches
    // the other role logins.
    if (!nurse) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, nurse.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT secret is not configured" });
    }

    const token = jwt.sign(
      { nurseId: nurse._id, email: nurse.email, role: "nurse" },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      nurse: {
        _id: nurse._id,
        name: nurse.name,
        email: nurse.email,
        role: "nurse",
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// PROFILE
// ===========================
exports.profile = async (req, res) => {
  try {
    const nurse = await Nurse.findById(req.nurse.nurseId).select("-password");

    if (!nurse) {
      return res.status(404).json({ message: "Nurse not found" });
    }

    res.status(200).json({ message: "Profile fetched successfully", nurse });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// TODAY'S CLINICAL PREPARATION LIST
// ===========================
// Only patients who have actually arrived: vitals are taken in the room, so a
// booking nobody has checked in yet is not the nurse's work. Cancelled and
// completed visits are excluded because neither can still be prepared.
exports.getQueue = async (req, res) => {
  try {
    const { todayStart, todayEnd } = getISTDayRange(new Date());

    const appointments = await Appointment.find({
      appointmentDate: { $gte: todayStart, $lte: todayEnd },
      checkedInAt: { $ne: null },
      status: { $in: ["Waiting", "In Consultation"] },
    })
      // Diagnosis, prescription and notes are the doctor's record. The nurse
      // has no reason to read them, so they are dropped at the query level
      // rather than hidden in the UI.
      .select("-diagnosis -prescription -notes")
      .populate("doctorId", "name specialization")
      .lean();

    // Same in-memory ordering as the doctor's queue, for the same reason: a
    // Mongo sort on `priority` orders the strings alphabetically.
    appointments.sort(byQueueOrder);

    res.status(200).json({
      message: "Queue fetched successfully",
      // Two lists rather than one flag, because they are two different jobs:
      // the first is what the nurse still has to do, the second is what they
      // have already handed to the doctor and may still need to correct.
      awaitingVitals: appointments.filter((a) => !a.readyForDoctorAt),
      readyForDoctor: appointments.filter((a) => a.readyForDoctorAt),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Shared by the record and ready endpoints: loads the appointment and refuses
// the ones whose clinical record is closed or void.
async function resolvePreparableAppointment(id, res) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    res.status(400).json({ message: "Invalid appointment ID" });
    return null;
  }

  const appointment = await Appointment.findById(id);

  if (!appointment) {
    res.status(404).json({ message: "Appointment not found" });
    return null;
  }

  if (appointment.status === "Cancelled") {
    res.status(400).json({ message: "Cannot prepare a cancelled appointment" });
    return null;
  }

  // Once the doctor has signed off, the visit record is closed - a later edit
  // would silently change what the completed consultation was based on.
  if (appointment.status === "Completed") {
    res
      .status(400)
      .json({ message: "Cannot change vitals on a completed consultation" });
    return null;
  }

  return appointment;
}

// ===========================
// RECORD / CORRECT VITALS
// ===========================
// The same endpoint records and corrects, because a mistyped weight has to be
// fixable in the same place it was entered. Sending every field blank clears
// the panel.
exports.recordVitals = async (req, res) => {
  try {
    const parsed = parseVitals(req.body);

    if (!parsed.ok) {
      return res.status(400).json({ message: parsed.message });
    }

    const appointment = await resolvePreparableAppointment(req.params.id, res);
    if (!appointment) return;

    const cleared = isEmptyVitals(parsed.vitals);

    Object.assign(appointment.vitals, parsed.vitals);
    appointment.vitals.recordedAt = cleared ? null : new Date();
    appointment.vitals.recordedBy = cleared ? null : req.nurse.nurseId;
    appointment.vitals.recordedByModel = cleared ? null : "Nurse";

    // Clearing the vitals withdraws the hand-off too: "ready for doctor" with
    // an empty panel is the state this feature exists to prevent.
    if (cleared) {
      appointment.readyForDoctorAt = null;
    }

    // BMI is recomputed by the model's pre-validate hook, not here.
    await appointment.save();

    res.status(200).json({
      message: cleared ? "Vitals cleared" : "Vitals recorded",
      vitals: appointment.vitals,
      readyForDoctorAt: appointment.readyForDoctorAt,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid vitals",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

// ===========================
// MARK READY FOR DOCTOR
// ===========================
exports.markReadyForDoctor = async (req, res) => {
  try {
    const appointment = await resolvePreparableAppointment(req.params.id, res);
    if (!appointment) return;

    // The hand-off asserts the patient has been prepared, so it has to mean
    // something was measured. Height and weight are the pair the doctor's
    // panel is built around and the only pair BMI can come from.
    if (!appointment.vitals?.heightCm || !appointment.vitals?.weightKg) {
      return res.status(400).json({
        message: "Record height and weight before marking the patient ready",
      });
    }

    // Idempotent: a second click must not move the hand-off time and make it
    // look like the patient waited less than they did.
    if (!appointment.readyForDoctorAt) {
      appointment.readyForDoctorAt = new Date();
      await appointment.save();
    }

    res.status(200).json({
      message: "Patient marked ready for the doctor",
      readyForDoctorAt: appointment.readyForDoctorAt,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
