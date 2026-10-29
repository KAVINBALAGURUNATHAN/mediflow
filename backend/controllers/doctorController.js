const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const Prescription = require("../models/Prescription");
const LabResult = require("../models/LabResult");
const LabOrder = require("../models/LabOrder");

// Both write endpoints below hang off an appointment, so they share the
// same gate: the appointment must exist and must belong to the calling
// doctor. Returns the appointment on success, or null after having already
// sent the response.
async function resolveOwnedAppointment(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ message: "Invalid appointment ID" });
    return null;
  }

  const appointment = await Appointment.findById(req.params.id);

  if (!appointment) {
    res.status(404).json({ message: "Appointment not found" });
    return null;
  }

  if (appointment.doctorId.toString() !== req.doctor.doctorId) {
    res.status(403).json({
      message: "You are not authorized to update this appointment",
    });
    return null;
  }

  return appointment;
}

// ===========================
// ISSUE PRESCRIPTION
// ===========================
// patientId/doctorId are taken from the appointment rather than the request
// body: the appointment is the only trustworthy link between this record and
// a real person, and accepting either from the client would let a doctor
// file a prescription against someone else's chart.
exports.issuePrescription = async (req, res) => {
  try {
    const appointment = await resolveOwnedAppointment(req, res);
    if (!appointment) return;

    const { medicines, notes } = req.body;

    if (!Array.isArray(medicines) || medicines.length === 0) {
      return res.status(400).json({
        message: "At least one medicine is required",
      });
    }

    const prescription = await Prescription.create({
      appointmentId: appointment._id,
      patientId: appointment.patient,
      doctorId: appointment.doctorId,
      medicines: medicines.map((m) => ({
        name: m?.name,
        dosage: m?.dosage,
        frequency: m?.frequency,
        durationDays: m?.durationDays,
        instructions: m?.instructions || "",
      })),
      notes: notes || "",
    });

    res.status(201).json({
      message: "Prescription issued",
      prescription,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid prescription details",
      });
    }
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// RECORD LAB RESULT
// ===========================
exports.recordLabResult = async (req, res) => {
  try {
    const appointment = await resolveOwnedAppointment(req, res);
    if (!appointment) return;

    const { testName, status, values, summary, orderedAt } = req.body;

    if (!testName?.trim()) {
      return res.status(400).json({ message: "Test name is required" });
    }

    if (status && !["Ordered", "In Progress", "Completed"].includes(status)) {
      return res.status(400).json({ message: "Invalid lab result status" });
    }

    const labResult = await LabResult.create({
      appointmentId: appointment._id,
      patientId: appointment.patient,
      doctorId: appointment.doctorId,
      testName: testName.trim(),
      status: status || "Ordered",
      orderedAt: orderedAt || undefined,
      values: Array.isArray(values)
        ? values.map((v) => ({
            parameter: v?.parameter,
            value: v?.value,
            unit: v?.unit || "",
            referenceRange: v?.referenceRange || "",
            flag: v?.flag || "Normal",
          }))
        : [],
      summary: summary || "",
    });

    res.status(201).json({
      message: "Lab result recorded",
      labResult,
    });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid lab result details",
      });
    }
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// APPOINTMENT CLINICAL RECORDS
// ===========================
// Everything the consultation screen needs in one call: what has been written
// during THIS visit, plus the same patient's earlier prescriptions and lab
// results so the doctor is not prescribing blind against an unseen history.
//
// History is keyed on the patient, not the appointment, and deliberately
// includes records written by other doctors - a prior prescription is
// relevant regardless of who wrote it.
exports.getAppointmentRecords = async (req, res) => {
  try {
    const appointment = await resolveOwnedAppointment(req, res);
    if (!appointment) return;

    const patientFilter = { patientId: appointment.patient };

    const [
      prescriptions,
      labResults,
      labOrders,
      historyPrescriptions,
      historyLabs,
    ] = await Promise.all([
        Prescription.find({ appointmentId: appointment._id })
          .populate("doctorId", "name specialization")
          .sort({ issuedAt: -1 }),

        LabResult.find({ appointmentId: appointment._id })
          .populate("doctorId", "name specialization")
          .sort({ orderedAt: -1 }),

        // Catalog-based orders (Phase 3). Returned alongside labResults
        // rather than merged into them: a LabResult from the old free-text
        // flow and a LabOrder pointing at a catalog entry are genuinely
        // different records, and flattening them would mean inventing a
        // labTestId for the legacy ones that no catalog entry backs.
        LabOrder.find({ appointmentId: appointment._id })
          .populate("labTestId", "name shortName category parameters isActive")
          .populate("doctorId", "name specialization")
          .sort({ orderedAt: -1 }),

        Prescription.find({
          ...patientFilter,
          appointmentId: { $ne: appointment._id },
        })
          .populate("doctorId", "name specialization")
          .populate("appointmentId", "bookingId appointmentDate")
          .sort({ issuedAt: -1 })
          .limit(20),

        LabResult.find({
          ...patientFilter,
          appointmentId: { $ne: appointment._id },
        })
          .populate("doctorId", "name specialization")
          .populate("appointmentId", "bookingId appointmentDate")
          .sort({ orderedAt: -1 })
          .limit(20),
      ]);

    // The free-text prescriptions written before the structured Prescription
    // collection existed still live on past appointments. Surfacing them
    // alongside is what makes "previous prescriptions" actually complete
    // rather than showing a history that silently starts at the cutover.
    const legacyNotes = await Appointment.find({
      patient: appointment.patient,
      _id: { $ne: appointment._id },
      prescription: { $nin: ["", null] },
    })
      .select("bookingId appointmentDate prescription diagnosis")
      .sort({ appointmentDate: -1 })
      .limit(20);

    res.status(200).json({
      current: { prescriptions, labResults, labOrders },
      history: {
        prescriptions: historyPrescriptions,
        labResults: historyLabs,
        legacyNotes,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// UPDATE LAB RESULT
// ===========================
// A test is ordered first and reported back later, so the ordering endpoint
// cannot be the only way to write one. This fills in the values on an
// existing order; testName, patient and doctor are fixed at order time and
// are not editable here, so a result can never be re-pointed at someone else.
exports.updateLabResult = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid lab result ID" });
    }

    const labResult = await LabResult.findById(req.params.id);

    if (!labResult) {
      return res.status(404).json({ message: "Lab result not found" });
    }

    if (labResult.doctorId.toString() !== req.doctor.doctorId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to update this lab result" });
    }

    // A result the LABORATORY reported is the lab's record, not the ordering
    // doctor's to rewrite. This endpoint predates the technician role, when
    // the doctor who ordered a test was also the only person who could enter
    // its values - so it accepted arbitrary parameter names, units and
    // reference ranges. Left open, it undoes the whole point of the catalog:
    // the doctor could rename a parameter, change a unit, or replace a
    // reported reading with a different number, in place and without trace.
    //
    // `labOrderId` is exactly the line between the two: results carrying one
    // came from the lab (Phase 5); those without are the legacy free-text
    // orders the doctor entered themselves, which stay editable because
    // nothing else can reach them.
    if (labResult.labOrderId) {
      return res.status(403).json({
        message:
          "This result was reported by the laboratory and cannot be edited here",
      });
    }

    const { status, values, summary } = req.body;

    if (status !== undefined) {
      if (!["Ordered", "In Progress", "Completed"].includes(status)) {
        return res.status(400).json({ message: "Invalid lab result status" });
      }
      labResult.status = status;
    }

    if (values !== undefined) {
      if (!Array.isArray(values)) {
        return res.status(400).json({ message: "Values must be a list" });
      }

      labResult.values = values.map((v) => ({
        parameter: v?.parameter,
        value: v?.value,
        unit: v?.unit || "",
        referenceRange: v?.referenceRange || "",
        flag: v?.flag || "Normal",
      }));
    }

    if (summary !== undefined) {
      labResult.summary = summary;
    }

    // The model's pre-validate hook enforces "Completed implies values" and
    // stamps resultedAt, so neither is decided here.
    await labResult.save();

    res.status(200).json({ message: "Lab result updated", labResult });
  } catch (error) {
    if (error.name === "ValidationError") {
      return res.status(400).json({
        message:
          Object.values(error.errors)[0]?.message || "Invalid lab result details",
      });
    }
    res.status(500).json({ message: error.message });
  }
};
