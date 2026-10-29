const mongoose = require("mongoose");

const settingsSchema = new mongoose.Schema({
  averageConsultationTime: {
    type: Number,
    default: 10,
  },

  // The GRACE PERIOD, in minutes. A patient who arrives at or before their
  // slot time plus this keeps their normal appointment and queue position;
  // arriving later makes them ELIGIBLE for the waiting-list workflow.
  //
  // Eligible, not moved: nothing in this application acts on lateness
  // automatically. See utils/lateness.js.
  graceMinutes: {
    type: Number,
    default: 5,
    min: 0,
    max: 240,
  },
});

module.exports = mongoose.model("Settings", settingsSchema);