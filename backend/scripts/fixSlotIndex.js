// One-off migration: repair the doctor/day/slot uniqueness rule.
//
// The schema always intended to exclude cancelled appointments from the
// unique slot index, but expressed it as { status: { $ne: "Cancelled" } }.
// MongoDB rejects $ne in a partialFilterExpression, so the index was created
// as a plain unique index instead. Effect: cancelling an appointment left it
// occupying its slot permanently - the slot picker offered the time again
// (it correctly ignores cancelled rows) while booking it always failed with
// "This slot is already booked".
//
// Mongoose never alters an index that already exists, so the old one has to
// be dropped explicitly. This script:
//   1. backfills slotActive on every existing appointment
//   2. drops the old plain unique index if present
//   3. rebuilds it as a partial index on { slotActive: true }
//
// Safe to run repeatedly.
require("dotenv").config();
const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");

const INDEX_NAME = "doctorId_1_appointmentDate_1_slot_1";

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const collection = mongoose.connection.db.collection("appointments");

  // 1. Backfill. Cancelled rows get false so they fall outside the partial
  // index (which matches only slotActive: true) and release their slot.
  const active = await Appointment.collection.updateMany(
    { status: { $ne: "Cancelled" } },
    { $set: { slotActive: true } }
  );
  const cancelled = await Appointment.collection.updateMany(
    { status: "Cancelled" },
    { $set: { slotActive: false } }
  );
  console.log(
    `backfilled: ${active.modifiedCount} active, ${cancelled.modifiedCount} cancelled`
  );

  // 2. Drop the old index if it exists in any form.
  const existing = await collection.indexes();
  const old = existing.find((i) => i.name === INDEX_NAME);

  if (old) {
    const isPartial = Boolean(old.partialFilterExpression?.slotActive);
    if (isPartial) {
      console.log("index already correct - nothing to drop");
    } else {
      await collection.dropIndex(INDEX_NAME);
      console.log("dropped old plain unique index");
    }
  } else {
    console.log("no existing slot index found");
  }

  // 3. Recreate as a partial index.
  await collection.createIndex(
    { doctorId: 1, appointmentDate: 1, slot: 1 },
    { unique: true, partialFilterExpression: { slotActive: true }, name: INDEX_NAME }
  );
  console.log("created partial unique index on { slotActive: true }");

  const after = (await collection.indexes()).find((i) => i.name === INDEX_NAME);
  console.log("final:", JSON.stringify(after.partialFilterExpression));

  await mongoose.disconnect();
})().catch((error) => {
  console.error("migration failed:", error.message);
  process.exit(1);
});
