// One-off, idempotent migration.
//
// BlockedSlot.date used to be normalized with setHours(0,0,0,0), which
// resolves in the server process's timezone. Documents created by the app
// running on an IST machine already sit at IST midnight and are correct;
// documents created on a UTC host (Render) sit at UTC midnight instead, and
// so fall outside the IST day window that getISTDayRange() now builds - the
// block exists in the database but never hides its slot.
//
// This rewrites every stored date to the IST-midnight instant for the IST
// calendar day it represents. Re-running it is a no-op.
require("dotenv").config();
const mongoose = require("mongoose");
const BlockedSlot = require("../models/BlockedSlot");
const { normalizeToIstDay } = require("../utils/istDay");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);

  const all = await BlockedSlot.find({}).select("_id date");
  let fixed = 0;

  for (const doc of all) {
    if (!(doc.date instanceof Date)) continue;
    const correct = normalizeToIstDay(doc.date);
    if (!correct || correct.getTime() === doc.date.getTime()) continue;

    console.log(
      `  ${doc._id}: ${doc.date.toISOString()} -> ${correct.toISOString()}`
    );
    await BlockedSlot.updateOne({ _id: doc._id }, { $set: { date: correct } });
    fixed += 1;
  }

  console.log(`\nScanned ${all.length} blocked slot(s), corrected ${fixed}.`);
  await mongoose.disconnect();
})();
