const mongoose = require("mongoose");

// Master list of real hospitals/clinics. Doctors reference one of these by
// ObjectId (see Doctor.js's hospitalId) instead of typing free text into
// the old `location` field - the actual fix for typos like "apolo" ending
// up in a real doctor record. Admins add hospitals here; latitude/longitude
// are optional for now (populated once real geolocation/Maps integration
// is wired up in a later pass - not invented here).
const hospitalSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },

    // Which branch of `name` this record is, e.g. "Downtown Clinic" for a
    // "MediFlow" that operates multiple locations under one brand.
    // Optional - single-location hospitals can leave this blank.
    branch: {
      type: String,
      trim: true,
      default: "",
    },

    phone: {
      type: String,
      trim: true,
      default: "",
    },

    address: {
      type: String,
      trim: true,
      default: "",
    },

    city: {
      type: String,
      trim: true,
      default: "",
    },

    state: {
      type: String,
      trim: true,
      default: "",
    },

    country: {
      type: String,
      trim: true,
      default: "",
    },

    latitude: {
      type: Number,
      default: null,
    },

    longitude: {
      type: Number,
      default: null,
    },

    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Hospital", hospitalSchema);
