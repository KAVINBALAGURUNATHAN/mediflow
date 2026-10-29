const mongoose = require("mongoose");

const doctorSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email format"],
    },

    password: {
      type: String,
      required: true,
      select: false,
    },

    // Password-reset token. Only the SHA-256 hash is stored, so a leaked
    // database cannot be used to reset anyone's password - the plaintext
    // exists only in the email that was sent. `select: false` keeps both out
    // of ordinary reads.
    resetTokenHash: {
      type: String,
      select: false,
    },

    resetTokenExpires: {
      type: Date,
      select: false,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 50,
    },

    // Free-text specialization/location remain required and are what every
    // existing route/frontend page already reads (doctor.specialization,
    // doctor.location) - kept for 100% backward compatibility. New doctors
    // created/edited through the admin dropdown (see adminController.js)
    // have these auto-derived from specializationId/hospitalId below, so a
    // typo can no longer enter through that path; direct API callers that
    // don't know about the new fields keep working exactly as before.
    specialization: {
      type: String,
      required: true,
      index: true,
    },

    location: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },

    // Optional references into the master lists (Specialization.js,
    // Hospital.js). Not required, so existing doctor records created
    // before these collections existed remain valid without a migration.
    specializationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Specialization",
      default: null,
    },

    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      default: null,
    },

    experience: {
      type: Number,
      required: true,
      min: 0,
      max: 80,
    },

    consultationFee: {
      type: Number,
      required: true,
      min: 0,
      max: 100000,
    },

    workingHours: {
      start: {
        type: String,
        match: [
          /^([01]\d|2[0-3]):([0-5]\d)$/,
          "Must be in HH:mm 24-hour format",
        ],
      },
      end: {
        type: String,
        match: [
          /^([01]\d|2[0-3]):([0-5]\d)$/,
          "Must be in HH:mm 24-hour format",
        ],
      },
    },

    // Which weekdays the doctor sees patients on. Defaults to Mon-Sat so
    // existing doctors created before this field existed still behave
    // sensibly wherever this is read (see utils/doctorAvailability.js's
    // DEFAULT_WORKING_DAYS fallback for docs already in the DB, since
    // Mongoose only applies schema defaults to newly-created documents,
    // not to older ones read back via find()/findById()).
    workingDays: {
      type: [String],
      enum: [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ],
      default: [
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
      ],
    },

    // Free-text qualification shown on the public profile (e.g. "MBBS, MD").
    // Optional - not every doctor record will have this set immediately.
    qualification: {
      type: String,
      trim: true,
      default: "",
    },

    slotDuration: {
      type: Number,
      default: 20,
      min: 5,
      max: 120,
    },

    isAvailable: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Ensures workingHours.end is chronologically after workingHours.start.
// Plain string comparison is valid here since both are enforced HH:mm
// 24-hour zero-padded strings by the match validators above - lexical
// order and chronological order agree for that exact format.
doctorSchema.pre("validate", function () {
  const { start, end } = this.workingHours || {};
  if (start && end && start >= end) {
    this.invalidate(
      "workingHours.end",
      "workingHours.end must be later than workingHours.start"
    );
  }
});

module.exports = mongoose.model("Doctor", doctorSchema);