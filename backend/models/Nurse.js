const mongoose = require("mongoose");

// Deliberately mirrors Receptionist: the four existing staff roles each own
// their own collection, login, JWT claim and middleware, and the nurse is a
// fifth of the same shape rather than a new shared-user abstraction. Adding a
// User model here would mean rewriting four working auth paths to gain nothing
// this feature needs.
const nurseSchema = new mongoose.Schema(
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
      enum: ["nurse"],
      default: "nurse",
      immutable: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Nurse", nurseSchema);
