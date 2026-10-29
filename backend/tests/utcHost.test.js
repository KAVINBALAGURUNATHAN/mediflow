const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");

const Doctor = require("../models/Doctor");
const Patient = require("../models/Patient");
const Appointment = require("../models/Appointment");
const BlockedSlot = require("../models/BlockedSlot");
const generateSlots = require("../utils/generateSlots");
const { normalizeToIstDay } = require("../utils/istDay");

// THE SERVER RUNS IN UTC HERE, ON PURPOSE.
//
// Render runs UTC; every developer on this project runs IST. That difference
// is the single most expensive bug class in this codebase - it has shipped to
// production twice - and the reason it keeps getting through is that the test
// suite ran in the same timezone as the developer, where the buggy and the
// correct code produce identical results. A green suite locally said nothing
// about the box the code actually runs on.
//
// appointmentDate is stored at IST midnight (Appointment's pre-save hook).
// Code that built a day window with setHours() got the SERVER's midnight, so
// on a UTC host the window was a different 24 hours from the one the data
// sits on: the slot-conflict lookup and the blocked-slot lookup both queried
// a day the records were not on.
//
// Booking is for TOMORROW rather than today, so this runs at any hour -
// today has no free slots left once the clinic closes.
// Unique across the suite: `node --test` runs these files in PARALLEL,
// so two suites on one port means whichever finishes first kills the
// server the other is still talking to - which surfaces as an
// unexplained "fetch failed" halfway through an unrelated test.
const PORT = 5094;
const BASE = `http://localhost:${PORT}`;
const PHONE = "9990000077";

let child;
let doctor;
let slot;
let istTomorrow;

async function req(pathname, { method = "GET", body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// The IST calendar date one day out, as the YYYY-MM-DD string the API takes.
function istDateString(date) {
  return new Date(normalizeToIstDay(date).getTime() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

describe("a UTC host handles IST calendar days correctly", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    doctor = await Doctor.findOne({ isAvailable: true });
    assert.ok(doctor, "an available doctor is needed");

    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    istTomorrow = istDateString(tomorrow);

    // A slot nobody holds tomorrow, so this never collides with a real
    // booking in the shared database.
    const dayStart = normalizeToIstDay(tomorrow);
    const taken = new Set(
      (
        await Appointment.find({
          doctorId: doctor._id,
          appointmentDate: dayStart,
          status: { $ne: "Cancelled" },
        }).select("slot")
      ).map((a) => a.slot)
    );

    slot = generateSlots(
      doctor.workingHours.start,
      doctor.workingHours.end,
      doctor.slotDuration
    ).find((s) => !taken.has(s));

    assert.ok(slot, "the doctor should have a free slot tomorrow");

    child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      // The whole point of this suite.
      env: { ...process.env, PORT: String(PORT), TZ: "UTC" },
      stdio: "ignore",
    });

    for (let i = 0; i < 60; i++) {
      try {
        await fetch(BASE + "/consultation-time");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    throw new Error("the UTC test server did not start");
  });

  after(async () => {
    await Appointment.deleteMany({ phone: PHONE });
    await Patient.deleteOne({ phone: PHONE });
    await BlockedSlot.deleteMany({ doctorId: doctor?._id, slot });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("a booking lands on the IST day the client asked for", async () => {
    const booked = await req("/appointments", {
      method: "POST",
      body: {
        doctorId: String(doctor._id),
        patientName: "UTC Host Probe",
        age: 44,
        phone: PHONE,
        symptoms: "automated timezone test",
        appointmentDate: istTomorrow,
        slot,
      },
    });

    assert.equal(booked.status, 201, JSON.stringify(booked.body));

    const stored = await Appointment.findOne({ phone: PHONE });

    assert.ok(stored, "the booking should persist");

    // The stored instant must be IST midnight of the requested day - not the
    // UTC midnight the server's own clock would have produced.
    assert.equal(
      stored.appointmentDate.getTime(),
      normalizeToIstDay(new Date(`${istTomorrow}T00:00:00.000Z`)).getTime(),
      "the appointment must be stored on the IST day that was requested"
    );

    assert.equal(stored.slot, slot);
  });

  // The sharpest test of the two lookups that were querying the wrong day.
  // On a UTC host the conflict check used to look at a window the first
  // booking was not in, so it found nothing and fell through - the unique
  // index caught it, but as a duplicate-key error rather than this answer.
  test("the slot-conflict check finds a booking made on the same IST day", async () => {
    const again = await req("/appointments", {
      method: "POST",
      body: {
        doctorId: String(doctor._id),
        patientName: "UTC Host Probe Two",
        age: 51,
        phone: PHONE,
        symptoms: "automated timezone test",
        appointmentDate: istTomorrow,
        slot,
      },
    });

    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.match(again.body.message, /already booked/i);

    // And exactly one appointment exists - the conflict was refused, not
    // written and then rolled back.
    assert.equal(await Appointment.countDocuments({ phone: PHONE }), 1);
  });

  test("a blocked slot is honoured on a UTC host", async () => {
    const otherSlot = generateSlots(
      doctor.workingHours.start,
      doctor.workingHours.end,
      doctor.slotDuration
    ).find((s) => s !== slot);

    await BlockedSlot.create({
      doctorId: doctor._id,
      date: normalizeToIstDay(new Date(`${istTomorrow}T00:00:00.000Z`)),
      slot: otherSlot,
      isFullDay: false,
      reason: "automated timezone test",
    });

    const blocked = await req("/appointments", {
      method: "POST",
      body: {
        doctorId: String(doctor._id),
        patientName: "UTC Host Probe Three",
        age: 33,
        phone: PHONE,
        symptoms: "automated timezone test",
        appointmentDate: istTomorrow,
        slot: otherSlot,
      },
    });

    await BlockedSlot.deleteMany({
      doctorId: doctor._id,
      slot: otherSlot,
      reason: "automated timezone test",
    });

    assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
    assert.match(blocked.body.message, /unavailable/i);
  });

  // A same-IST-day booking must not be rejected as "in the past" because the
  // server's own midnight has not come round yet.
  test("today is not treated as a past date on a UTC host", async () => {
    const res = await req("/appointments", {
      method: "POST",
      body: {
        doctorId: String(doctor._id),
        patientName: "UTC Host Probe Four",
        age: 29,
        phone: PHONE,
        symptoms: "automated timezone test",
        appointmentDate: istDateString(new Date()),
        // Deliberately not a real slot: this asserts on WHICH complaint comes
        // back, and the date check runs before the slot check. Whatever else
        // is wrong with the request, "in the past" must not be the answer for
        // a date that is today in IST.
        slot: "not-a-real-slot",
      },
    });

    assert.notEqual(
      res.body.message,
      "Appointment date cannot be in the past",
      "today in IST must never read as a past date"
    );
  });
});
