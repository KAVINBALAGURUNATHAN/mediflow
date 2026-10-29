// Removes test fixtures that a crashed test run left behind.
//
//   node scripts/cleanTestResidue.js          # report only
//   node scripts/cleanTestResidue.js --delete # actually remove them
//
// WHY THIS EXISTS
//
// Dev and production share one Atlas cluster (section 1 of the handoff). The
// test suites create their own patients, staff and appointments and remove
// them again, but WHILE A SUITE IS RUNNING those records are real rows in the
// real database - so a receptionist looking at the dashboard mid-run sees
// names like "Waiting Probe 1" sitting in the waiting list. If a run crashes
// between create and cleanup, they stay.
//
// This is a mop, not a fix. The actual fix is pointing the tests at a separate
// database (Remaining Work, high priority). Until then, run this if test names
// appear in the UI.
//
// SAFETY
//
// It matches ONLY the reserved fixture identifiers the suites use:
//   - phone numbers beginning 999000       (never issued to a real patient)
//   - emails ending @example.invalid       (a reserved TLD, cannot exist)
// Real patient data is not matched by either, and nothing is deleted without
// --delete.

require("dotenv").config();
const mongoose = require("mongoose");

const Patient = require("../models/Patient");
const Appointment = require("../models/Appointment");
const WaitingListEntry = require("../models/WaitingListEntry");
const BlockedSlot = require("../models/BlockedSlot");
const LabOrder = require("../models/LabOrder");
const LabResult = require("../models/LabResult");
const Prescription = require("../models/Prescription");
const Nurse = require("../models/Nurse");
const LabTechnician = require("../models/LabTechnician");
const Doctor = require("../models/Doctor");
const LabTest = require("../models/LabTest");

// Reserved test phone prefix. Indian mobile numbers do not begin 9990 00.
const TEST_PHONE = /^999000/;
// A reserved TLD (RFC 2606) - no real address can end in it.
const TEST_EMAIL = /@example\.invalid$/;
// The prefix the catalog suite uses for throwaway lab tests.
const TEST_LAB_TEST = /^ZZ /;

// Names that LOOK like manual testing. Matched on the NAME alone, so they are
// only ever REPORTED - never deleted, not even with --delete.
//
// The patterns above are safe to act on because no real record can hold them:
// 999000 is not an issued mobile prefix, and .invalid cannot resolve. A name
// is different. "Test" is a real surname, and a patient called Testa or Priya
// Testani would match this and be destroyed by an automated sweep.
//
// So this half puts a human in the loop instead: it points at rows that smell
// like leftovers from hand-testing and lets somebody who knows the clinic
// decide. Only ORPHANS are listed - anything with an appointment or a waiting
// entry attached is somebody's actual history, whatever it is called.
const SUSPICIOUS_NAME = /\b(test|probe|dummy|sample|demo)\b/i;

async function main() {
  const apply = process.argv.includes("--delete");

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set - this script reads backend/.env");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const patients = await Patient.find({ phone: TEST_PHONE }).select("_id name phone").lean();
  const doctors = await Doctor.find({ email: TEST_EMAIL }).select("_id name email").lean();
  const patientIds = patients.map((p) => p._id);
  const doctorIds = doctors.map((d) => d._id);

  const appointments = await Appointment.find({
    $or: [
      { phone: TEST_PHONE },
      ...(doctorIds.length ? [{ doctorId: { $in: doctorIds } }] : []),
    ],
  })
    .select("_id")
    .lean();

  const appointmentIds = appointments.map((a) => a._id);

  const found = {
    patients: patients.length,
    doctors: doctors.length,
    appointments: appointmentIds.length,
    waitingListEntries: await WaitingListEntry.countDocuments({
      patient: { $in: patientIds },
    }),
    labOrders: await LabOrder.countDocuments({
      appointmentId: { $in: appointmentIds },
    }),
    labResults: await LabResult.countDocuments({
      appointmentId: { $in: appointmentIds },
    }),
    prescriptions: await Prescription.countDocuments({
      appointmentId: { $in: appointmentIds },
    }),
    blockedSlots: doctorIds.length
      ? await BlockedSlot.countDocuments({ doctorId: { $in: doctorIds } })
      : 0,
    nurses: await Nurse.countDocuments({ email: TEST_EMAIL }),
    labTechnicians: await LabTechnician.countDocuments({ email: TEST_EMAIL }),
    labTests: await LabTest.countDocuments({ name: TEST_LAB_TEST }),
  };

  const total = Object.values(found).reduce((sum, n) => sum + n, 0);

  console.log("Test residue found:");
  for (const [what, count] of Object.entries(found)) {
    if (count > 0) console.log(`  ${count.toString().padStart(4)}  ${what}`);
  }

  if (total === 0) {
    console.log("  (none - the database is clean)");
    // Still worth reporting: a clean fixture sweep says nothing about rows
    // left behind by hand-testing, which is where these usually come from.
    await reportSuspicious();
    await mongoose.disconnect();
    return;
  }

  if (patients.length) {
    console.log("\nPatients matched:");
    for (const p of patients) console.log(`  ${p.name} (${p.phone})`);
  }

  if (!apply) {
    console.log(`\n${total} record(s). Re-run with --delete to remove them.`);
    await reportSuspicious();
    await mongoose.disconnect();
    return;
  }

  // Children before parents, so nothing is orphaned midway.
  await LabResult.deleteMany({ appointmentId: { $in: appointmentIds } });
  await LabOrder.deleteMany({ appointmentId: { $in: appointmentIds } });
  await Prescription.deleteMany({ appointmentId: { $in: appointmentIds } });
  await WaitingListEntry.deleteMany({ patient: { $in: patientIds } });
  await Appointment.deleteMany({ _id: { $in: appointmentIds } });
  if (doctorIds.length) {
    await BlockedSlot.deleteMany({ doctorId: { $in: doctorIds } });
  }
  await Patient.deleteMany({ _id: { $in: patientIds } });
  await Doctor.deleteMany({ _id: { $in: doctorIds } });
  await Nurse.deleteMany({ email: TEST_EMAIL });
  await LabTechnician.deleteMany({ email: TEST_EMAIL });
  await LabTest.deleteMany({ name: TEST_LAB_TEST });

  console.log(`\nRemoved ${total} record(s).`);
  await reportSuspicious();
  await mongoose.disconnect();
}

// Report only. See SUSPICIOUS_NAME above for why this never deletes.
async function reportSuspicious() {
  const candidates = await Patient.find({ name: SUSPICIOUS_NAME })
    .select("_id name phone createdAt")
    .lean();

  const orphans = [];

  for (const candidate of candidates) {
    // Already handled by the reserved-pattern sweep above.
    if (TEST_PHONE.test(candidate.phone || "")) continue;

    const [appointments, waiting] = await Promise.all([
      Appointment.countDocuments({ patient: candidate._id }),
      WaitingListEntry.countDocuments({ patient: candidate._id }),
    ]);

    // Anything with history attached is treated as a real patient.
    if (appointments === 0 && waiting === 0) orphans.push(candidate);
  }

  if (!orphans.length) return;

  console.log(
    `\n${orphans.length} patient record(s) look like manual testing and have`
  );
  console.log("no appointments or waiting-list entries attached:\n");

  for (const orphan of orphans) {
    const created = orphan.createdAt
      ? new Date(orphan.createdAt).toISOString().slice(0, 10)
      : "unknown";
    console.log(`  ${orphan.name} (${orphan.phone}) created ${created}`);
  }

  console.log(
    "\nNOT deleted - a name is not proof. Review these by hand before removing"
  );
  console.log(
    "any of them. Without an appointment they cannot reach a queue anyway."
  );
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
