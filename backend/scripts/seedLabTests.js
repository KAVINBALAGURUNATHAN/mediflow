// Seeds the five demo lab tests the catalog ships with.
//
//   node scripts/seedLabTests.js
//
// Idempotent and NON-DESTRUCTIVE: a test whose name already exists is left
// exactly as it is. If an admin has edited a reference range through the
// catalog screen, re-running this must not quietly revert it, so this script
// only ever inserts what is missing and reports what it skipped.
//
// ⚠️ THE REFERENCE RANGES BELOW ARE DEMO PLACEHOLDERS.
// They are typical published adult values, included so the catalog and the
// generated result forms have something realistic to render. They are NOT
// validated against any particular laboratory. Real ranges depend on the assay
// method, the analyser, and the patient's sex and age - before this is used on
// a real patient, every range here must be replaced with the ones the actual
// lab issues. The catalog is editable through the admin screen precisely so
// that this is a five-minute job rather than a code change.

require("dotenv").config();
const mongoose = require("mongoose");
const LabTest = require("../models/LabTest");

const n = (name, unit, referenceRange) => ({
  name,
  unit,
  dataType: "number",
  required: true,
  referenceRange,
});

const DEMO_TESTS = [
  {
    name: "Complete Blood Count",
    shortName: "CBC",
    category: "Haematology",
    parameters: [
      n("Haemoglobin", "g/dL", "13.0 - 17.0"),
      n("White Blood Cells", "/µL", "4,000 - 11,000"),
      n("Platelets", "/µL", "150,000 - 450,000"),
      n("Red Blood Cells", "million/µL", "4.5 - 5.9"),
      n("Haematocrit", "%", "40 - 50"),
    ],
  },
  {
    name: "Blood Glucose",
    shortName: "Glucose",
    category: "Biochemistry",
    parameters: [
      n("Fasting Blood Sugar", "mg/dL", "70 - 100"),
      // Not always run alongside the fasting reading, so it does not block
      // completing the test.
      { ...n("Post Prandial Blood Sugar", "mg/dL", "< 140"), required: false },
      { ...n("Random Blood Sugar", "mg/dL", "< 140"), required: false },
    ],
  },
  {
    name: "Liver Function Test",
    shortName: "LFT",
    category: "Biochemistry",
    parameters: [
      n("Total Bilirubin", "mg/dL", "0.3 - 1.2"),
      n("Direct Bilirubin", "mg/dL", "0.0 - 0.3"),
      n("SGOT (AST)", "U/L", "5 - 40"),
      n("SGPT (ALT)", "U/L", "7 - 56"),
      n("Alkaline Phosphatase", "U/L", "44 - 147"),
      n("Total Protein", "g/dL", "6.0 - 8.3"),
      n("Albumin", "g/dL", "3.5 - 5.0"),
    ],
  },
  {
    name: "Lipid Profile",
    shortName: "Lipids",
    category: "Biochemistry",
    parameters: [
      n("Total Cholesterol", "mg/dL", "< 200"),
      n("Triglycerides", "mg/dL", "< 150"),
      n("HDL Cholesterol", "mg/dL", "> 40"),
      n("LDL Cholesterol", "mg/dL", "< 100"),
      n("VLDL Cholesterol", "mg/dL", "5 - 40"),
    ],
  },
  {
    name: "Thyroid Profile",
    shortName: "TFT",
    category: "Endocrinology",
    parameters: [
      n("TSH", "µIU/mL", "0.4 - 4.0"),
      n("T3", "ng/dL", "80 - 200"),
      n("T4", "µg/dL", "5.0 - 12.0"),
    ],
  },
];

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set - this script reads backend/.env");
  }

  await mongoose.connect(process.env.MONGO_URI);

  let inserted = 0;
  let skipped = 0;

  for (const definition of DEMO_TESTS) {
    // Matched case-insensitively, the same way the unique index does, so
    // re-running cannot create "CBC" beside "cbc".
    const existing = await LabTest.findOne({ name: definition.name })
      .collation({ locale: "en", strength: 2 })
      .lean();

    if (existing) {
      console.log(`skipped  ${definition.name} (already in the catalog)`);
      skipped += 1;
      continue;
    }

    await LabTest.create(definition);
    console.log(
      `inserted ${definition.name} (${definition.parameters.length} parameters)`
    );
    inserted += 1;
  }

  console.log(`\n${inserted} inserted, ${skipped} left untouched.`);
  console.log(
    "Reference ranges are demo placeholders - replace them with your lab's own."
  );

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
