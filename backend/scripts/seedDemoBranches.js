// Idempotent seed for the MediFlow demo clinic network.
// Run with: node scripts/seedDemoBranches.js
//
// MediFlow is a fictional multi-specialty clinic network. Every branch,
// address and phone number below is a placeholder for demo purposes only and
// does not belong to any real hospital or clinic.
//
// latitude/longitude are left null on purpose: GET /hospitals/nearest skips
// branches without coordinates, and FindBranch then falls back to letting the
// patient pick a branch manually. Set coordinates from the admin UI if you
// want to demo the "nearest branch" flow.
require("dotenv").config();
const mongoose = require("mongoose");
const Hospital = require("../models/Hospital");

const DEMO_BRANCHES = [
  {
    name: "MediFlow",
    branch: "Downtown Clinic",
    address: "100 Demo Street (placeholder address)",
    city: "Demo City",
    state: "",
    country: "",
    phone: "+91 00000 00001",
    latitude: null,
    longitude: null,
  },
  {
    name: "MediFlow",
    branch: "Riverside Clinic",
    address: "200 Sample Avenue (placeholder address)",
    city: "Demo City",
    state: "",
    country: "",
    phone: "+91 00000 00002",
    latitude: null,
    longitude: null,
  },
  {
    name: "MediFlow",
    branch: "Hillview Clinic",
    address: "300 Example Road (placeholder address)",
    city: "Demo City",
    state: "",
    country: "",
    phone: "+91 00000 00003",
    latitude: null,
    longitude: null,
  },
];

async function seed() {
  await mongoose.connect(process.env.MONGO_URI);

  let created = 0;
  let skipped = 0;

  for (const branch of DEMO_BRANCHES) {
    const existing = await Hospital.findOne({
      name: new RegExp(`^${branch.name}$`, "i"),
      branch: new RegExp(`^${branch.branch}$`, "i"),
    });

    if (existing) {
      skipped++;
      continue;
    }

    await Hospital.create(branch);
    created++;
  }

  console.log(`Seed complete: ${created} created, ${skipped} already existed.`);
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
