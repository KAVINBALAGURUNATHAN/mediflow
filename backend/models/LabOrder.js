const mongoose = require("mongoose");

// A doctor's request for one catalog test, for one patient, on one visit.
//
// This is the middle of the three lab concepts and the one that was missing:
//
//   LabTest    the reusable definition  - what a CBC IS      (catalog)
//   LabOrder   this model               - "run a CBC on this patient" (request)
//   LabResult  the reported values      - what the CBC SHOWED (result)
//
// Before this existed, `LabResult` did the middle job too: a document was
// created at order time with an empty `values[]` and a free-text `testName`,
// so "CBC" and "Complete Blood Count" were two different tests and nothing
// could pre-populate the parameters. An order now points at a catalog entry by
// id, which is what lets the result form be generated rather than typed.
//
// The doctor orders the TEST, never its parameters. There is deliberately no
// parameter field here - parameters belong to the LabTest, and copying them
// onto the order would create a second place they could disagree.
const labOrderSchema = new mongoose.Schema(
  {
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      index: true,
    },

    // Taken from the appointment at order time, never from the request body -
    // the appointment is the only trustworthy link between this order and a
    // real person. Same rule as issuePrescription.
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
      index: true,
    },

    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    labTestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LabTest",
      required: true,
    },

    // Matches LabResult's vocabulary so the two never need translating
    // between. "Cancelled" is new: an order placed by mistake has to be
    // withdrawable without deleting the record of it having happened.
    status: {
      type: String,
      enum: ["Ordered", "In Progress", "Completed", "Cancelled"],
      default: "Ordered",
    },

    orderedAt: {
      type: Date,
      default: Date.now,
    },

    // Stamped when the lab picks the order up (Ordered -> In Progress).
    // Separate from orderedAt because the gap between the two is the only
    // measure of how long a sample sat waiting.
    startedAt: {
      type: Date,
      default: null,
    },

    // Bare ObjectId rather than a ref, matching Appointment.vitals.recordedBy:
    // nothing populates it today, and a ref that is never resolved is a
    // promise the code does not keep.
    startedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    // Free text from the ordering doctor, e.g. "fasting sample". Not a
    // clinical finding - that is the result's job.
    note: {
      type: String,
      trim: true,
      default: "",
      maxlength: 500,
    },
  },
  { timestamps: true }
);

// One live order per test per visit. Ordering a CBC twice on the same
// appointment is a double-click or a second doctor repeating the first, not a
// clinical intention, and it would put two identical rows on the technician's
// worklist with no way to tell them apart.
//
// Partial on the active statuses, so withdrawing an order genuinely frees the
// test to be ordered again - a unique index over every status would make a
// cancelled order block its own replacement forever.
labOrderSchema.index(
  { appointmentId: 1, labTestId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      status: { $in: ["Ordered", "In Progress", "Completed"] },
    },
  }
);

labOrderSchema.index({ patientId: 1, orderedAt: -1 });

// The technician worklist (Phase 4) reads outstanding orders across all
// patients, so it needs to filter on status without scanning.
labOrderSchema.index({ status: 1, orderedAt: 1 });

module.exports = mongoose.model("LabOrder", labOrderSchema);
