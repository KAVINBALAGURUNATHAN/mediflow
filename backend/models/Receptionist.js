const mongoose = require("mongoose");

const receptionistSchema = new mongoose.Schema(
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
      enum: ["receptionist"],
      default: "receptionist",
      immutable: true,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Receptionist", receptionistSchema);