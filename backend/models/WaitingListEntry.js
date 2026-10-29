const mongoose = require("mongoose");

// The BACKUP QUEUE for one doctor on one day.
//
// It holds people who want to be seen but do not currently hold a live slot:
// walk-ins, patients who arrived too late for their own slot, and patients
// whose appointment became a no-show but who are still here. When a slot
// genuinely frees up, someone is taken off this list and given it.
//
// It is deliberately NOT the queue. The queue (derived from Appointment) is
// people who hold a slot today; this is people waiting for one. Merging them
// would mean inventing an appointment for someone who has not been given a
// time yet - and an appointment with no slot is exactly the half-state the
// booking rules exist to prevent.
const waitingListEntrySchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    // IST midnight, like Appointment.appointmentDate. The list is per doctor
    // per day: yesterday's waiting patients are not waiting today.
    date: {
      type: Date,
      required: true,
    },

    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    // Copied at add time so the list renders without a populate, and so it
    // still reads correctly if the patient record is later edited.
    patientName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
    },

    // Same vocabulary and same ordering rule as the live queue, so a High
    // priority patient does not lose that standing by being moved here.
    priority: {
      type: String,
      enum: ["High", "Normal", "Low"],
      default: "Normal",
    },

    priorityReason: {
      type: String,
      enum: ["", "Senior Citizen", "Emergency", "Pregnant", "Disabled"],
      default: "",
    },

    // Why they are on the list. This is the difference between a walk-in and
    // someone whose 10:00 slot came and went, and it is what makes the list
    // readable to whoever works it next.
    reason: {
      type: String,
      enum: ["Walk-in", "Late arrival", "Missed appointment", "Other"],
      default: "Walk-in",
    },

    // Set when the entry came from an existing appointment (a late arrival or
    // a no-show), so the two records stay connected rather than the patient
    // appearing to have arrived from nowhere.
    sourceAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },

    // The appointment created when this entry was given a vacancy. Its
    // presence is what makes "already assigned" impossible to fake.
    assignedAppointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      default: null,
    },

    // "Waiting"  - on the list, eligible for the next vacancy
    // "Assigned" - given a slot; assignedAppointmentId points at it
    // "Removed"  - taken off the list without a slot (left, or no longer needed)
    status: {
      type: String,
      enum: ["Waiting", "Assigned", "Removed"],
      default: "Waiting",
    },

    addedAt: {
      type: Date,
      default: Date.now,
    },

    // Bare ObjectId, matching Appointment.vitals.recordedBy: nothing populates
    // it, and a ref that is never resolved is a promise the code does not keep.
    addedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },

    assignedAt: {
      type: Date,
      default: null,
    },

    removedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true }
);

// Normalising the day here rather than at every call site, the same way
// Appointment does it - a date that is not IST midnight silently lands on a
// different list.
const { normalizeToIstDay } = require("../utils/istDay");

waitingListEntrySchema.pre("save", function () {
  if (this.date) {
    this.date = normalizeToIstDay(this.date);
  }

  // A reason always implies High priority, mirroring the rule check-in and
  // updatePriority already enforce on appointments. Without this the same
  // patient could rank differently depending on which list they were on.
  if (this.priorityReason) {
    this.priority = "High";
  }
});

// One live entry per patient per doctor per day. Partial on "Waiting" so a
// patient who was assigned a slot and later needs the list again is not
// blocked forever by their own historical row.
//
// The index is what actually prevents the duplicate - a findOne check in the
// controller would lose a double-clicked "Add" button.
waitingListEntrySchema.index(
  { doctorId: 1, date: 1, patient: 1 },
  {
    unique: true,
    partialFilterExpression: { status: "Waiting" },
  }
);

// The list is read constantly and always for one doctor-day.
waitingListEntrySchema.index({ doctorId: 1, date: 1, status: 1 });

module.exports = mongoose.model("WaitingListEntry", waitingListEntrySchema);
