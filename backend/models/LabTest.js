const mongoose = require("mongoose");

// One measurable parameter within a test panel - the *definition*, not a
// patient's reading. This is what a result-entry form is generated from, so
// everything a form needs to render a field lives here and nowhere else.
//
// Deliberately shaped to line up with LabResult's `values[]` subdocument
// (parameter / unit / referenceRange), because a completed result is filled in
// from this definition. The two are not the same document: a reference range
// can be revised, and a result already reported must keep the range it was
// read against, so the range is copied onto the result rather than looked up
// through it.
const labParameterSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Parameter name is required"],
      trim: true,
      maxlength: 120,
    },

    unit: {
      type: String,
      trim: true,
      default: "",
      maxlength: 30,
    },

    // What kind of input the result form should render. "number" covers a
    // measured reading; "text" covers the qualitative ones real reports carry
    // ("Negative", "Not Detected", "<0.01") which LabResult already stores as
    // strings for exactly this reason.
    dataType: {
      type: String,
      enum: ["number", "text"],
      default: "number",
    },

    // Whether the result form must have this filled in before the technician
    // can complete the test. Not every parameter on a panel is always run.
    required: {
      type: Boolean,
      default: true,
    },

    // Free text, e.g. "13.0 - 17.0" or "< 200". Free rather than a
    // min/max pair because real ranges are qualified by sex, age and assay
    // method, and flattening that into two numbers would quietly assert a
    // precision the catalog does not have. Blank where a range does not apply.
    referenceRange: {
      type: String,
      trim: true,
      default: "",
      maxlength: 60,
    },
  },
  { _id: false }
);

const labTestSchema = new mongoose.Schema(
  {
    // The catalog exists so that "CBC", "C.B.C." and "Complete Blood Count"
    // stop being three different tests, so the name is unique and matched
    // case-insensitively via the collation on the index below.
    name: {
      type: String,
      required: [true, "Test name is required"],
      trim: true,
      maxlength: 150,
      // Uniqueness is declared once, on the collated index at the bottom of
      // this file. A field-level `unique: true` here would build a SECOND,
      // non-collated index on the same key - which would let "cbc" in beside
      // "CBC", exactly the collision the catalog exists to stop.
    },

    // What the doctor and the lab actually say out loud ("CBC", "LFT").
    shortName: {
      type: String,
      trim: true,
      default: "",
      maxlength: 30,
    },

    category: {
      type: String,
      trim: true,
      default: "General",
      maxlength: 60,
    },

    parameters: {
      type: [labParameterSchema],
      default: [],
    },

    // Retiring a test rather than deleting it: results already reported
    // against it must keep making sense, and a deleted definition would
    // orphan them.
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  { timestamps: true }
);

labTestSchema.pre("validate", function () {
  // A test with no parameters generates an empty result form, which a
  // technician cannot complete and the LabResult model would reject anyway
  // (a completed result must carry at least one value). Catching it here
  // means the catalog can never hold one.
  if (!this.parameters?.length) {
    this.invalidate("parameters", "A lab test must define at least one parameter");
    return;
  }

  // Two parameters with the same name would render two identical fields on
  // the result form with no way to tell which reading went where.
  const seen = new Set();

  for (const parameter of this.parameters) {
    const key = String(parameter.name || "").trim().toLowerCase();

    if (seen.has(key)) {
      this.invalidate(
        "parameters",
        `Duplicate parameter name: ${parameter.name}`
      );
      return;
    }

    seen.add(key);
  }
});

// Case-insensitive uniqueness, so "cbc" cannot be added alongside "CBC".
// The collation belongs on the index rather than being enforced in the
// controller, because only the index holds under a concurrent write.
labTestSchema.index(
  { name: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

module.exports = mongoose.model("LabTest", labTestSchema);
