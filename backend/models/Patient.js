const mongoose = require("mongoose");
const { getNextSequence } = require("./Counter");

// Patient is now a PERMANENT record - one document per real person,
// created once and reused across all their visits. It holds only
// information that rarely changes. Anything specific to a single visit
// (symptoms, diagnosis, prescription, token number, priority, status)
// lives on the Appointment model instead, linked back here via patientId.
const patientSchema = new mongoose.Schema(
  {
    // Hospital-generated ID, e.g. "PAT000123". Auto-assigned via an
    // atomic counter (see Counter.js) so concurrent patient creation
    // can never produce a duplicate.
    patientId: {
      type: String,
      unique: true,
    },

    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      match: [/^[6-9]\d{9}$/, "Invalid phone number"],
    },

    email: {
      type: String,
      lowercase: true,
      trim: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Invalid email format"],
    },

    // Google's stable "sub" id. Separate from email, which can change on the
    // Google side. Sparse so non-Google patients don't collide on `null`.
    googleId: {
      type: String,
      unique: true,
      sparse: true,
    },

    // Present only once a patient registers a login (see patientController.js).
    // Patients created automatically during booking (find-or-create in
    // POST /appointments) have no password until they register -
    // registering "claims" that existing record by phone rather than
    // creating a duplicate one.
    password: {
      type: String,
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

    dob: {
      type: Date,
      validate: {
        validator: function (value) {
          return !value || value <= new Date();
        },
        message: "Date of birth cannot be in the future",
      },
    },

    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
    },

    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
    },

    address: {
      type: String,
      trim: true,
    },

    emergencyContact: {
      name: {
        type: String,
        trim: true,
      },
      phone: {
        type: String,
        trim: true,
        match: [/^[6-9]\d{9}$/, "Invalid phone number"],
      },
      relationship: {
        type: String,
        trim: true,
      },
    },

    // Known, standing allergies/conditions for this person - distinct
    // from Appointment.medicalConditions, which is a free-text note
    // captured at a single visit's intake, not a permanent structured list.
    allergies: [String],
    medicalConditions: [String],

    insurance: {
      provider: {
        type: String,
        trim: true,
      },
      policyNumber: {
        type: String,
        trim: true,
      },
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

patientSchema.pre("validate", async function () {
  if (!this.patientId) {
    const seq = await getNextSequence("patientId");
    this.patientId = `PAT${String(seq).padStart(6, "0")}`;
  }
});

module.exports = mongoose.model("Patient", patientSchema);