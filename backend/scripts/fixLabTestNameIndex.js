// Rebuilds the LabTest name index with a case-insensitive collation.
//
//   node scripts/fixLabTestNameIndex.js
//
// Why this exists: LabTest.name was first declared with a field-level
// `unique: true` AND a collated `schema.index()`. Mongoose builds the
// field-level one and does not replace it, so the index that ended up in the
// database was `name_1` with NO collation - which enforces uniqueness only
// byte-for-byte. "cbc" could be added right next to "CBC", which is precisely
// the collision the catalog was built to stop.
//
// The field-level declaration is gone from the model now. This drops the
// leftover index so the collated one can build in its place.
//
// Idempotent: run it as many times as you like.

require("dotenv").config();
const mongoose = require("mongoose");
const LabTest = require("../models/LabTest");

const COLLATED = { locale: "en", strength: 2 };

async function main() {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is not set - this script reads backend/.env");
  }

  await mongoose.connect(process.env.MONGO_URI);

  const collection = LabTest.collection;
  const indexes = await collection.indexes();
  const existing = indexes.find((index) => index.name === "name_1");

  if (!existing) {
    console.log("no name_1 index present - nothing to drop");
  } else if (existing.collation) {
    console.log("name_1 already has a collation - nothing to do");
    await mongoose.disconnect();
    return;
  } else {
    // A duplicate that differs only by case would have been impossible to
    // insert under the old index anyway for an exact match, but two entries
    // like "CBC" and "cbc" could both exist. The collated unique index cannot
    // build over those, so say so plainly rather than failing obscurely.
    const clashes = await collection
      .aggregate([
        { $group: { _id: { $toLower: "$name" }, count: { $sum: 1 } } },
        { $match: { count: { $gt: 1 } } },
      ])
      .toArray();

    if (clashes.length) {
      console.error(
        "Cannot rebuild: these names differ only by case and must be merged first:"
      );
      for (const clash of clashes) console.error(`  ${clash._id}`);
      await mongoose.disconnect();
      process.exitCode = 1;
      return;
    }

    await collection.dropIndex("name_1");
    console.log("dropped the non-collated name_1 index");
  }

  await collection.createIndex(
    { name: 1 },
    { unique: true, collation: COLLATED, name: "name_1" }
  );

  console.log("created name_1 with a case-insensitive collation");
  console.log(JSON.stringify(await collection.indexes(), null, 1));

  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error.message);
  await mongoose.disconnect().catch(() => {});
  process.exitCode = 1;
});
