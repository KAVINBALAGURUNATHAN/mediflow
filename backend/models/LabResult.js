const mongoose = require("mongoose");

// A single measured parameter within one test panel.
const labValueSchema = new mongoose.Schema(
  {
    parameter: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },

    // String, not Number: real lab reports mix numeric readings with
    // qualitative ones ("Negative", "Not Detected", "<0.01"), and storing
    // those as numbers would either lose them or force a fake 0.
    value: {
      type: String,
      required: true,
      trim: true,
      maxlength: 60,
    },

    unit: {
      type: String,
      trim: true,
      default: "",
      maxlength: 30,
    },

    // Free text, e.g. "13.0 - 17.0" or "< 200". The lab supplies this per
    // parameter and it varies by method and by patient demographics, so it
    // is recorded with the result rather than looked up from a fixed table.
    referenceRange: {
      type: String,
      trim: true,
      default: "",
      maxlength: 60,
    },

    // Set by whoever records the result, not derived: referenceRange above
    // is free text and cannot be reliably compared against programmatically.
    flag: {
      type: String,
      enum: ["Normal", "High", "Low"],
      default: "Normal",
    },
  },
  { _id: false }
);

const labResultSchema = new mongoose.Schema(
  {
    // The order this result answers. Optional, and deliberately so: results
    // created before the catalog existed have a free-text testName and no
    // order to point at. Backfilling one would mean inventing a LabOrder that
    // was never placed, so those keep reading exactly as they were recorded.
    //
    // Unique where present (see the partial index below): one result per
    // order, so a double-submitted form cannot produce two reports of the
    // same test.
    labOrderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LabOrder",
      default: null,
    },

    // Which catalog definition the values were generated from. Also optional
    // for the same reason.
    labTestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "LabTest",
      default: null,
    },

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

    testName: {
      type: String,
      required: true,
      trim: true,
      maxlength: 150,
    },

    orderedAt: {
      type: Date,
      default: Date.now,
    },

    // Null until the lab actually reports back.
    resultedAt: {
      type: Date,
      default: null,
    },

    status: {
      type: String,
      enum: ["Ordered", "In Progress", "Completed"],
      default: "Ordered",
    },

    values: {
      type: [labValueSchema],
      default: [],
    },

    summary: {
      type: String,
      trim: true,
      default: "",
      maxlength: 2000,
    },
  },
  { timestamps: true }
);

// A "Completed" result with no values would show a patient a finished test
// with nothing in it, so completion and having values are enforced together
// rather than left to each caller. resultedAt is stamped here for the same
// reason Appointment stamps completedAt in its pre-save hook.
labResultSchema.pre("validate", function () {
  if (this.status !== "Completed") return;

  if (!this.values?.length) {
    this.invalidate("values", "A completed lab result must contain at least one value");
  }

  if (!this.resultedAt) {
    this.resultedAt = new Date();
  }
});

labResultSchema.index({ patientId: 1, orderedAt: -1 });

// One result per order. Partial, because the legacy free-text results have no
// labOrderId and a plain unique index would treat all of their nulls as
// duplicates of each other.
labResultSchema.index(
  { labOrderId: 1 },
  {
    unique: true,
    partialFilterExpression: { labOrderId: { $type: "objectId" } },
  }
);

module.exports = mongoose.model("LabResult", labResultSchema);
