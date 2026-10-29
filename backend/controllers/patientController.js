const Patient = require("../models/Patient");
const Appointment = require("../models/Appointment");
const Prescription = require("../models/Prescription");
const LabResult = require("../models/LabResult");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const sanitizeAppointmentForPatient = require("../utils/sanitizeAppointmentForPatient");
const { requestReset, performReset } = require("../utils/passwordReset");
const { sendCancellation, sendReschedule } = require("../utils/appointmentMail");
const sanitizeLabResultForPatient = require("../utils/sanitizeLabResultForPatient");
const Doctor = require("../models/Doctor");
const generateSlots = require("../utils/generateSlots");
const { normalizeToIstDay } = require("../utils/istDay");

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const phoneRegex = /^[6-9]\d{9}$/;

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

function issuePatientToken(patient) {
  return jwt.sign(
    {
      patientId: patient._id,
      phone: patient.phone,
      role: "patient",
    },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// ===========================
// REGISTER
// ===========================
// Registration "claims" the existing Patient record for this phone number
// (auto-created during a booking's find-or-create logic) rather than
// creating a duplicate - a patient may have booked appointments as a guest
// long before ever registering a login.
exports.register = async (req, res) => {
  try {
    const { name, email, phone, password, confirmPassword } = req.body;

    if (!name?.trim() || !email?.trim() || !phone?.trim() || !password || !confirmPassword) {
      return res.status(400).json({
        message: "All fields are required",
      });
    }

    if (!emailRegex.test(email.trim().toLowerCase())) {
      return res.status(400).json({
        message: "Invalid email format",
      });
    }

    const trimmedPhone = phone.trim();

    if (!phoneRegex.test(trimmedPhone)) {
      return res.status(400).json({
        message: "Invalid phone number. Must be a valid 10-digit Indian mobile number.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        message: "Passwords do not match",
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Email must be unique among ACCOUNTS (patients who already have a
    // password) - not among every guest booking record, since those never
    // collect email today and could theoretically share a blank one.
    const emailInUse = await Patient.findOne({
      email: normalizedEmail,
      password: { $exists: true, $ne: null },
    });

    if (emailInUse) {
      return res.status(409).json({
        message: "An account with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    let patient = await Patient.findOne({ phone: trimmedPhone }).select("+password");

    if (patient) {
      if (patient.password) {
        return res.status(409).json({
          message: "An account with this phone number already exists. Please login instead.",
        });
      }

      patient.name = name.trim();
      patient.email = normalizedEmail;
      patient.password = hashedPassword;

      await patient.save();
    } else {
      patient = await Patient.create({
        name: name.trim(),
        email: normalizedEmail,
        phone: trimmedPhone,
        password: hashedPassword,
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT secret is not configured",
      });
    }

    const token = jwt.sign(
      {
        patientId: patient._id,
        phone: patient.phone,
        role: "patient",
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(201).json({
      message: "Account created successfully",
      token,
      patient: {
        _id: patient._id,
        name: patient.name,
        email: patient.email,
        phone: patient.phone,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "An account with this phone number already exists.",
      });
    }

    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// LOGIN
// ===========================
exports.login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const patient = await Patient.findOne({
      email: email.trim().toLowerCase(),
    }).select("+password");

    if (!patient || !patient.password) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(password, patient.password);

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
        patientId: patient._id,
        phone: patient.phone,
        role: "patient",
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      patient: {
        _id: patient._id,
        name: patient.name,
        email: patient.email,
        phone: patient.phone,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// PROFILE
// ===========================
exports.getProfile = async (req, res) => {
  try {
    const patient = await Patient.findById(req.patient.patientId);

    if (!patient) {
      return res.status(404).json({
        message: "Patient not found",
      });
    }

    res.status(200).json({
      patient,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// UPDATE PROFILE
// ===========================
// Patients may edit their own demographic details. Phone is deliberately not
// editable here: it is the key appointments are looked up by (see
// getMyAppointments), so changing it would orphan a patient's booking history.
// Email is also fixed, since it identifies Google-linked accounts.
const EDITABLE_FIELDS = ["name", "dob", "gender", "bloodGroup", "address"];

exports.updateProfile = async (req, res) => {
  try {
    const patient = await Patient.findById(req.patient.patientId);

    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    if (req.body.name !== undefined && !String(req.body.name).trim()) {
      return res.status(400).json({ message: "Name cannot be empty" });
    }

    for (const field of EDITABLE_FIELDS) {
      if (req.body[field] === undefined) continue;
      const value = req.body[field];
      // Empty string clears an optional field rather than failing validation
      // on enum/date casts.
      patient[field] = value === "" ? undefined : value;
    }

    if (req.body.emergencyContact !== undefined) {
      const { name, phone, relationship } = req.body.emergencyContact || {};
      patient.emergencyContact = {
        name: name || undefined,
        phone: phone || undefined,
        relationship: relationship || undefined,
      };
    }

    await patient.save();

    res.status(200).json({
      message: "Profile updated",
      patient,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid profile details",
      });
    }
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// MY APPOINTMENTS
// ===========================
exports.getMyAppointments = async (req, res) => {
  try {
    const patient = await Patient.findById(req.patient.patientId);

    if (!patient) {
      return res.status(404).json({
        message: "Patient not found",
      });
    }

    const appointments = await Appointment.find({ phone: patient.phone })
      .populate("doctorId", "name specialization location")
      .sort({ appointmentDate: -1, createdAt: -1 });

    res.status(200).json({
      appointments: appointments.map(sanitizeAppointmentForPatient),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// PRESCRIPTIONS / LAB RESULTS
// ===========================
// Clinical records are stamped with patientId at creation time, but this
// deliberately also matches on the appointments getMyAppointments would
// return (which resolve by phone). A person who booked as a guest before
// registering can own more than one route to the same records, and matching
// only one of the two would silently hide part of their own history.
// Nothing here widens access: an appointment on this patient's phone is
// already treated as theirs by every other patient-facing route.
async function buildOwnRecordsFilter(patient) {
  const ownAppointmentIds = await Appointment.find({ phone: patient.phone })
    .distinct("_id");

  return {
    $or: [{ patientId: patient._id }, { appointmentId: { $in: ownAppointmentIds } }],
  };
}

exports.getMyPrescriptions = async (req, res) => {
  try {
    const patient = await Patient.findById(req.patient.patientId);

    if (!patient) {
      return res.status(404).json({
        message: "Patient not found",
      });
    }

    const prescriptions = await Prescription.find(await buildOwnRecordsFilter(patient))
      .populate("doctorId", "name specialization")
      .populate("appointmentId", "bookingId appointmentDate")
      .sort({ issuedAt: -1, createdAt: -1 });

    // Consultations completed before the structured Prescription collection
    // existed recorded their medicines as free text on the appointment. They
    // are returned separately - rather than reshaped to look structured -
    // because the individual medicines were never parsed out and pretending
    // otherwise would invent dosages that were never recorded. Without this
    // the patient's history silently begins at the cutover.
    const legacyPrescriptions = await Appointment.find({
      phone: patient.phone,
      prescription: { $nin: ["", null] },
    })
      .populate("doctorId", "name specialization")
      .select("bookingId appointmentDate prescription diagnosis doctorId")
      .sort({ appointmentDate: -1 });

    res.status(200).json({
      prescriptions,
      legacyPrescriptions,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

exports.getMyLabResults = async (req, res) => {
  try {
    const patient = await Patient.findById(req.patient.patientId);

    if (!patient) {
      return res.status(404).json({
        message: "Patient not found",
      });
    }

    const labResults = await LabResult.find(await buildOwnRecordsFilter(patient))
      .populate("doctorId", "name specialization")
      .populate("appointmentId", "bookingId appointmentDate")
      .sort({ orderedAt: -1, createdAt: -1 });

    res.status(200).json({
      labResults: labResults.map(sanitizeLabResultForPatient),
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

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: "New password must be at least 8 characters",
      });
    }

    const patient = await Patient.findById(req.patient.patientId).select("+password");

    if (!patient) {
      return res.status(404).json({
        message: "Patient not found",
      });
    }

    const isMatch = await bcrypt.compare(currentPassword, patient.password);

    if (!isMatch) {
      return res.status(400).json({
        message: "Current password is incorrect",
      });
    }

    patient.password = await bcrypt.hash(newPassword, 10);

    await patient.save();

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
// GOOGLE SIGN-IN
// ===========================
// Step 1: verify the ID token, then either log the patient in or hand back a
// short-lived signup token so the frontend can collect a phone number (which
// Google doesn't provide, and which appointments are looked up by). Account
// details come only from Google's verified payload, never from the client.
exports.googleAuth = async (req, res) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      return res.status(400).json({ message: "Google ID token is required" });
    }

    if (!process.env.GOOGLE_CLIENT_ID || !process.env.JWT_SECRET) {
      return res.status(500).json({ message: "Google sign-in is not configured" });
    }

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const normalizedEmail = payload.email?.trim().toLowerCase();

    if (!normalizedEmail || !payload.email_verified) {
      return res.status(401).json({ message: "Google account email is not verified" });
    }

    let patient = await Patient.findOne({
      $or: [{ googleId: payload.sub }, { email: normalizedEmail }],
    });

    if (patient) {
      if (!patient.googleId) {
        patient.googleId = payload.sub;
        await patient.save();
      }

      return res.status(200).json({
        message: "Login successful",
        token: issuePatientToken(patient),
        patient: {
          _id: patient._id,
          name: patient.name,
          email: patient.email,
          phone: patient.phone,
        },
      });
    }

    // No existing account - carry the verified identity in a signed token so
    // step 2 doesn't have to re-trust client-supplied profile data.
    const signupToken = jwt.sign(
      {
        purpose: "google-signup",
        googleId: payload.sub,
        email: normalizedEmail,
        name: payload.name || normalizedEmail,
      },
      process.env.JWT_SECRET,
      { expiresIn: "10m" }
    );

    res.status(200).json({
      needsPhone: true,
      signupToken,
      profile: { name: payload.name, email: normalizedEmail },
    });
  } catch (error) {
    res.status(401).json({ message: "Google sign-in failed: " + error.message });
  }
};

// Step 2 (new patients only): consumes the signupToken plus a phone number.
// Find-or-creates like register() does, since a guest record from a past
// booking may already exist for this phone and should be claimed, not
// duplicated.
exports.googleComplete = async (req, res) => {
  try {
    const { signupToken, phone } = req.body;

    if (!signupToken || !phone?.trim()) {
      return res.status(400).json({ message: "Signup token and phone are required" });
    }

    const trimmedPhone = phone.trim();

    if (!phoneRegex.test(trimmedPhone)) {
      return res.status(400).json({
        message: "Invalid phone number. Must be a valid 10-digit Indian mobile number.",
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(signupToken, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ message: "Signup session expired. Please sign in with Google again." });
    }

    if (decoded.purpose !== "google-signup") {
      return res.status(401).json({ message: "Invalid signup token" });
    }

    const emailInUse = await Patient.findOne({
      email: decoded.email,
      password: { $exists: true, $ne: null },
    });

    if (emailInUse) {
      return res.status(409).json({ message: "An account with this email already exists" });
    }

    let patient = await Patient.findOne({ phone: trimmedPhone });

    if (patient) {
      if (patient.googleId && patient.googleId !== decoded.googleId) {
        return res.status(409).json({
          message: "This phone number is already linked to a different Google account",
        });
      }
      patient.email = patient.email || decoded.email;
      patient.googleId = decoded.googleId;
      await patient.save();
    } else {
      patient = await Patient.create({
        name: decoded.name,
        email: decoded.email,
        phone: trimmedPhone,
        googleId: decoded.googleId,
      });
    }

    res.status(201).json({
      message: "Account created successfully",
      token: issuePatientToken(patient),
      patient: {
        _id: patient._id,
        name: patient.name,
        email: patient.email,
        phone: patient.phone,
      },
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ message: "An account with this phone number already exists." });
    }
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// PASSWORD RESET
// ===========================
// Both handlers delegate to utils/passwordReset so the token rules stay
// identical to the doctor flow. forgotPassword always answers 200 with the
// same body - see the note there about not leaking which emails exist.
exports.forgotPassword = async (req, res) => {
  try {
    const result = await requestReset({
      Model: Patient,
      email: req.body.email,
      role: "patient",
      resetPath: "/reset-password",
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.resetPassword = async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    const r = await performReset({ Model: Patient, email, token, newPassword });
    res.status(r.status).json({ message: r.message });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// CANCEL / RESCHEDULE (patient-initiated)
// ===========================
// Ownership is resolved the same way getMyAppointments does - by matching the
// appointment's phone against the logged-in patient's - so a patient can only
// ever touch their own bookings regardless of the id they pass.
const mongoose = require("mongoose");
const BlockedSlot = require("../models/BlockedSlot");

async function loadOwnAppointment(req) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    return { error: { status: 400, message: "Invalid appointment ID" } };
  }

  const patient = await Patient.findById(req.patient.patientId);
  if (!patient) return { error: { status: 404, message: "Patient not found" } };

  const appointment = await Appointment.findById(req.params.id);
  if (!appointment) return { error: { status: 404, message: "Appointment not found" } };

  if (appointment.phone !== patient.phone) {
    return { error: { status: 403, message: "Access denied" } };
  }

  return { patient, appointment };
}

exports.cancelMyAppointment = async (req, res) => {
  try {
    const { appointment, error } = await loadOwnAppointment(req);
    if (error) return res.status(error.status).json({ message: error.message });

    // A finished consultation is part of the medical record; cancelling it
    // would misrepresent what actually happened.
    if (appointment.status === "Completed") {
      return res.status(400).json({ message: "Completed appointments cannot be cancelled" });
    }

    if (appointment.status === "Cancelled") {
      return res.status(400).json({ message: "This appointment is already cancelled" });
    }

    if (appointment.status === "In Consultation") {
      return res
        .status(400)
        .json({ message: "This consultation has already started. Please speak to reception." });
    }

    appointment.status = "Cancelled";
    appointment.cancelledAt = new Date();
    await appointment.save();

    req.app.get("io")?.emit("queueUpdated", { doctorId: appointment.doctorId });
    sendCancellation(appointment).catch(() => {});

    res.status(200).json({
      message: "Appointment cancelled",
      appointment: sanitizeAppointmentForPatient(appointment),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.rescheduleMyAppointment = async (req, res) => {
  try {
    const { appointment, error } = await loadOwnAppointment(req);
    if (error) return res.status(error.status).json({ message: error.message });

    const { appointmentDate, slot } = req.body;
    if (!appointmentDate || !slot) {
      return res.status(400).json({ message: "appointmentDate and slot are required" });
    }

    if (appointment.status === "Completed" || appointment.status === "Cancelled") {
      return res
        .status(400)
        .json({ message: `${appointment.status} appointments cannot be rescheduled` });
    }

    if (appointment.status === "In Consultation") {
      return res
        .status(400)
        .json({ message: "This consultation has already started. Please speak to reception." });
    }

    const day = new Date(appointmentDate);
    if (isNaN(day.getTime())) {
      return res.status(400).json({ message: "Invalid appointment date" });
    }
    day.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (day.getTime() < today.getTime()) {
      return res.status(400).json({ message: "Cannot reschedule to a past date" });
    }

    const dayStart = new Date(day);
    const dayEnd = new Date(day);
    dayEnd.setHours(23, 59, 59, 999);

    // The slot must be one this doctor actually offers. Booking has always
    // checked this; reschedule did not, so any string was accepted - a
    // patient could move themselves to "99:99 ZZ", which no queue or slot
    // view can place, and which sorts as time zero in the queue order.
    const doctor = await Doctor.findById(appointment.doctorId);
    if (!doctor) {
      return res.status(404).json({ message: "Doctor not found" });
    }

    const validSlots = generateSlots(
      doctor.workingHours.start,
      doctor.workingHours.end,
      doctor.slotDuration
    );

    if (!validSlots.includes(slot)) {
      return res.status(400).json({ message: "Invalid appointment slot" });
    }

    // Same availability rules the doctor-side reschedule enforces: a slot the
    // doctor has blocked, or one already taken, cannot be moved into.
    const blocked = await BlockedSlot.findOne({
      doctorId: appointment.doctorId,
      date: { $gte: dayStart, $lte: dayEnd },
      $or: [{ isFullDay: true }, { isFullDay: false, slot }],
    });
    if (blocked) {
      return res.status(409).json({ message: "Selected slot is unavailable" });
    }

    const clash = await Appointment.findOne({
      _id: { $ne: appointment._id },
      doctorId: appointment.doctorId,
      appointmentDate: { $gte: dayStart, $lte: dayEnd },
      slot,
      status: { $ne: "Cancelled" },
    });
    if (clash) {
      return res.status(409).json({ message: "Selected slot is already booked" });
    }

    appointment.appointmentDate = day;
    appointment.slot = slot;

    // Re-issue the token for the NEW day rather than clearing it. Tokens are
    // assigned at booking so a patient is visible in the queue and can open
    // their own waiting-room page (its route is keyed on the token) - leaving
    // a rescheduled patient with no token would silently take both away.
    // Numbering is per doctor per day, so the old day's token cannot follow.
    // Normalized the same way the model stores it - dayStart/dayEnd are built
    // with setHours and so resolve in the server's timezone, which does not
    // line up with the stored IST-normalized date on a UTC host.
    const lastToken = await Appointment.findOne({
      _id: { $ne: appointment._id },
      doctorId: appointment.doctorId,
      appointmentDate: normalizeToIstDay(day),
      tokenNumber: { $ne: null },
    })
      .sort({ tokenNumber: -1 })
      .select("tokenNumber");

    appointment.tokenNumber = (lastToken?.tokenNumber || 0) + 1;
    // checkedInAt must be cleared too: a rescheduled appointment has not been
    // arrived-for yet, and check-in now refuses anyone who already carries a
    // checkedInAt - leaving it set would make the patient impossible to check
    // in on the new date.
    appointment.checkedInAt = undefined;
    appointment.consultationStartedAt = undefined;
    appointment.status = "Waiting";
    await appointment.save();

    req.app.get("io")?.emit("queueUpdated", { doctorId: appointment.doctorId });
    sendReschedule(appointment).catch(() => {});

    res.status(200).json({
      message: "Appointment rescheduled",
      appointment: sanitizeAppointmentForPatient(appointment),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
