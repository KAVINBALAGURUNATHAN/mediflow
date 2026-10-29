const mongoose = require("mongoose");

// One prescribed drug. Kept as a subdocument array rather than the single
// free-text Appointment.prescription string (which stays untouched for the
// existing doctor/receptionist/report flows) so a patient-facing page can
// render dosage and duration as structured fields instead of asking the
// patient to parse a paragraph.
const medicineSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    dosage: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },

    frequency: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },

    durationDays: {
      type: Number,
      required: true,
      min: 1,
      max: 365,
    },

    instructions: {
      type: String,
      trim: true,
      default: "",
      maxlength: 300,
    },
  },
  { _id: false }
);

const prescriptionSchema = new mongoose.Schema(
  {
    // The consultation this was written during. Every prescription in this
    // system originates from a real appointment - there is no standalone
    // prescribing flow - so this is required, and it is what the doctor's
    // write authorization is checked against.
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      index: true,
    },

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

    issuedAt: {
      type: Date,
      default: Date.now,
    },

    medicines: {
      type: [medicineSchema],
      validate: {
        validator: (list) => Array.isArray(list) && list.length > 0,
        message: "A prescription must contain at least one medicine",
      },
    },

    notes: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Derived, never stored: a stored Active/Completed flag would silently go
// stale the moment a course ran out, since nothing in this app runs a job
// to flip it. Computing it on read is always correct.
prescriptionSchema.virtual("status").get(function () {
  if (!this.issuedAt || !this.medicines?.length) return "Completed";

  const longestCourseDays = this.medicines.reduce(
    (max, m) => Math.max(max, m.durationDays || 0),
    0
  );

  const endsAt = new Date(this.issuedAt);
  endsAt.setDate(endsAt.getDate() + longestCourseDays);

  return endsAt > new Date() ? "Active" : "Completed";
});

// Patient-facing list is always "my prescriptions, newest first".
prescriptionSchema.index({ patientId: 1, issuedAt: -1 });

module.exports = mongoose.model("Prescription", prescriptionSchema);
