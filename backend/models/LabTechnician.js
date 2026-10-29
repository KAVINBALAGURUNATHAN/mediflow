const mongoose = require("mongoose");

// Deliberately mirrors Nurse and Receptionist: every staff role owns its own
// collection, login, JWT claim and middleware, and the lab technician is
// another of the same shape rather than a new shared-user abstraction.
// Introducing a User model here would mean rewriting five working auth paths
// to gain nothing this feature needs.
const labTechnicianSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

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

    role: {
      type: String,
      enum: ["labTechnician"],
      default: "labTechnician",
      immutable: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("LabTechnician", labTechnicianSchema);
