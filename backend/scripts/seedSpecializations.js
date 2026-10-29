// One-time, idempotent seed for the Specialization master list.
// Run with: node scripts/seedSpecializations.js
//
// Deliberately does NOT seed any Hospital entries - hospital identity is
// specific to whoever runs this deployment, not something to invent.
// Admins add real hospitals themselves via the new Hospital management UI.
require("dotenv").config();
const mongoose = require("mongoose");
const Specialization = require("../models/Specialization");

const STANDARD_SPECIALIZATIONS = [
  "Cardiology",
  "Dermatology",
  "General Medicine",
  "Orthopedics",
  "Neurology",
  "Neurosurgery",
  "Pediatrics",
  "Gynecology",
  "Psychiatry",
  "ENT",
  "Urology",
  "Nephrology",
  "Pulmonology",
  "Oncology",
  "Radiology",
  "Emergency Medicine",
  "Family Medicine",
  "Plastic Surgery",
  "Anesthesiology",
  "Ophthalmology",
  "Dentistry",
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);

  let created = 0;
  let skipped = 0;

  for (const name of STANDARD_SPECIALIZATIONS) {
    const existing = await Specialization.findOne({
      name: new RegExp(`^${name}$`, "i"),
    });

    if (existing) {
      skipped++;
      continue;
    }

    await Specialization.create({ name });
    created++;
  }

  console.log(`Seed complete: ${created} created, ${skipped} already existed.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
