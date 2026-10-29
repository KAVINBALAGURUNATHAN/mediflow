const mongoose = require("mongoose");

// Minimal atomic-counter collection, used to generate safe sequential IDs
// (e.g. Patient.patientId) without the race condition that a naive
// "find the highest existing ID and add 1" approach has under concurrent
// writes. findOneAndUpdate's $inc is atomic at the database level, so two
// simultaneous requests can never receive the same number.
const counterSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    unique: true,
  },
  seq: {
    type: Number,
    default: 0,
  },
});

const Counter = mongoose.model("Counter", counterSchema);

// Returns the next number in the named sequence, creating the counter
// document on first use.
const getNextSequence = async (name) => {
  const counter = await Counter.findOneAndUpdate(
    { name },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

module.exports = { Counter, getNextSequence };