const mongoose = require("mongoose");

// Master list of valid medical specialties. Doctors reference one of these
// by ObjectId (see Doctor.js's specializationId) instead of typing free
// text - this is the actual fix for typos like "Pedricatiost" ending up in
// a real doctor record: the frontend can only ever submit an _id from this
// collection, never arbitrary text.
const specializationSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },

    // Optional friendlier label for display, if different from `name`
    // (e.g. name: "ENT", displayName: "Ear, Nose & Throat"). Falls back to
    // `name` wherever unset.
    displayName: {
      type: String,
      trim: true,
      default: "",
    },

    icon: {
      type: String,
      trim: true,
      default: "",
    },

    description: {
      type: String,
      trim: true,
      default: "",
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Specialization", specializationSchema);
