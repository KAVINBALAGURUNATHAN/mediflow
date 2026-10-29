const { test, before, after, beforeEach, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const Nurse = require("../models/Nurse");
const Receptionist = require("../models/Receptionist");
const Appointment = require("../models/Appointment");
const { normalizeToIstDay } = require("../utils/istDay");

// What the nurse's queue is allowed to contain, asserted against the state
// the RECEPTIONIST actually produces rather than against a fixture written to
// match the query.
//
// The reported symptom was "reception checks a patient in and the nurse never
// sees them". Every link in that chain is exercised here in one run - book,
// check in, appear, prepare, hand over - because each one can be correct on
// its own while the chain still fails.
//
// THE SERVER RUNS IN UTC. Render does, every developer here does not, and
// this queue is scoped to an IST calendar day. A day-boundary mistake in
// either the check-in window or the queue window is invisible on an IST
// machine and empties the nurse's screen on the real one.
// Unique across the suite: `node --test` runs these files in PARALLEL,
// so two suites on one port means whichever finishes first kills the
// server the other is still talking to - which surfaces as an
// unexplained "fetch failed" halfway through an unrelated test.
const PORT = 5093;
const BASE = `http://localhost:${PORT}`;
const PHONE = "9990000088";
const OTHER_PHONE = "9990000089";
const NURSE_EMAIL = "nurse.queue.9990000088@example.invalid";

let child;
let doctor;
let otherDoctor;
let patient;
let otherPatient;
let nurse;
let receptionist;

async function req(pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const nurseToken = () =>
  jwt.sign({ nurseId: String(nurse._id), role: "nurse" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

const receptionistToken = () =>
  jwt.sign(
    { receptionistId: String(receptionist._id), role: "receptionist" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

const doctorToken = (id) =>
  jwt.sign({ doctorId: String(id), role: "doctor" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

// A booking, in exactly the state the patient portal leaves one in: today,
// waiting, holding a token, and NOT checked in. Everything after this is
// reception's doing.
//
// The slot is synthetic so these can never collide with a genuine booking in
// the shared database - dev and production share one Atlas cluster.
async function makeBooking(who, overrides = {}) {
  return Appointment.create({
    patient: who._id,
    patientName: who.name,
    phone: who.phone,
    age: 39,
    gender: "Female",
    doctorId: doctor._id,
    appointmentDate: normalizeToIstDay(new Date()),
    slot: `nq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symptoms: "automated test",
    status: "Waiting",
    // An explicit token, as a real booking has. Without one the check-in
    // path assigns the next in sequence, and `node --test` runs suites in
    // parallel, so two tokenless fixtures on one doctor could race the unique
    // token index and fail the check-in this suite is trying to observe.
    tokenNumber: 7000 + Math.floor(Math.random() * 900),
    ...overrides,
  });
}

const inQueue = (queue, appointment) =>
  queue.awaitingVitals.filter((a) => String(a._id) === String(appointment._id));

describe("the nurse's queue reflects reception's check-ins", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const doctors = await Doctor.find({ isAvailable: true }).limit(2);
    doctor = doctors[0];
    otherDoctor = doctors[1] || doctors[0];
    receptionist = await Receptionist.findOne();

    assert.ok(doctor, "needs an available doctor");
    assert.ok(receptionist, "needs a receptionist");

    const mkPatient = (phone, name) =>
      Patient.findOneAndUpdate(
        { phone },
        {
          $setOnInsert: {
            name,
            phone,
            email: `probe.${phone}@example.invalid`,
            password: bcrypt.hashSync("probe-password-not-real", 4),
          },
        },
        { upsert: true, new: true }
      );

    patient = await mkPatient(PHONE, "Nurse Queue Probe");
    otherPatient = await mkPatient(OTHER_PHONE, "Nurse Queue Probe Two");

    nurse = await Nurse.findOneAndUpdate(
      { email: NURSE_EMAIL },
      {
        $setOnInsert: {
          name: "Nurse Queue Probe Nurse",
          email: NURSE_EMAIL,
          password: await bcrypt.hash("probe-password-not-real", 4),
        },
      },
      { upsert: true, new: true }
    );

    child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      // The production timezone, deliberately.
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

    throw new Error("the nurse queue test server did not start");
  });

  beforeEach(async () => {
    await Appointment.deleteMany({ phone: { $in: [PHONE, OTHER_PHONE] } });
  });

  after(async () => {
    await Appointment.deleteMany({ phone: { $in: [PHONE, OTHER_PHONE] } });
    await Patient.deleteMany({ phone: { $in: [PHONE, OTHER_PHONE] } });
    await Nurse.deleteOne({ email: NURSE_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  // The reported bug, start to finish, on a UTC host.
  test("a patient reception checks in reaches the nurse, exactly once", async () => {
    const booking = await makeBooking(patient);

    // BEFORE: booked but not arrived. The nurse prepares people who are in
    // the building, so a booking on its own must not appear.
    const before = await req("/nurse/queue", { token: nurseToken() });
    assert.equal(before.status, 200);
    assert.equal(
      inQueue(before.body, booking).length,
      0,
      "a patient who has not arrived must not be on the nurse's queue"
    );

    // Reception checks them in - the real endpoint, not a direct write.
    const checkedIn = await req(
      `/receptionist/appointments/${booking._id}/check-in`,
      {
        method: "PATCH",
        token: receptionistToken(),
        body: { priority: "Normal" },
      }
    );
    assert.equal(checkedIn.status, 200, JSON.stringify(checkedIn.body));

    // The state check-in actually wrote, read back from the database rather
    // than trusted from the response.
    const stored = await Appointment.findById(booking._id);
    assert.ok(stored.checkedInAt, "check-in must stamp checkedInAt");
    assert.equal(stored.status, "Waiting", "check-in leaves the status alone");
    assert.equal(
      stored.appointmentDate.getTime(),
      normalizeToIstDay(new Date()).getTime(),
      "the appointment must still sit on today's IST day"
    );

    // AFTER: on the queue, once.
    const after = await req("/nurse/queue", { token: nurseToken() });
    const matches = inQueue(after.body, booking);

    assert.equal(matches.length, 1, "checked in means exactly one queue entry");
    assert.equal(matches[0].patientName, "Nurse Queue Probe");
    assert.ok(matches[0].doctorId?.name, "the nurse needs to see whose patient this is");

    // And not in the other list, which is for patients already handed over.
    assert.equal(
      after.body.readyForDoctor.filter(
        (a) => String(a._id) === String(booking._id)
      ).length,
      0,
      "a patient with no vitals has not been handed to the doctor"
    );
  });

  // The rest of the chain: prepare, hand over, and become the doctor's.
  test("recording vitals hands the patient to the doctor", async () => {
    const booking = await makeBooking(patient);

    await req(`/receptionist/appointments/${booking._id}/check-in`, {
      method: "PATCH",
      token: receptionistToken(),
      body: { priority: "Normal" },
    });

    const recorded = await req(`/nurse/appointments/${booking._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: {
        heightCm: 165,
        weightKg: 60,
        bloodPressureSystolic: 118,
        bloodPressureDiastolic: 76,
        temperatureC: 36.8,
        pulseBpm: 72,
        spo2: 99,
        respiratoryRate: 15,
      },
    });
    assert.equal(recorded.status, 200, JSON.stringify(recorded.body));

    const ready = await req(`/nurse/appointments/${booking._id}/ready`, {
      method: "PATCH",
      token: nurseToken(),
    });
    assert.equal(ready.status, 200);

    // They MOVE between the two lists - they are not in both, and not gone.
    const queue = await req("/nurse/queue", { token: nurseToken() });

    assert.equal(
      inQueue(queue.body, booking).length,
      0,
      "a prepared patient leaves the awaiting-vitals list"
    );
    assert.equal(
      queue.body.readyForDoctor.filter(
        (a) => String(a._id) === String(booking._id)
      ).length,
      1,
      "and appears once under ready for doctor"
    );

    // The doctor sees the measurements, on the same appointment.
    const seen = await req(`/appointments/${booking._id}`, {
      token: doctorToken(doctor._id),
    });

    assert.equal(seen.status, 200);
    assert.equal(seen.body.appointment.vitals.bmi, 22);
    assert.equal(seen.body.appointment.vitals.respiratoryRate, 15);
    assert.equal(seen.body.appointment.vitals.recordedByModel, "Nurse");
  });

  // The queue is one IST calendar day wide. Yesterday's and tomorrow's
  // patients are not the nurse's problem today, and on a UTC host a
  // half-day-out window would put the wrong ones there.
  test("only today's patients are on the queue", async () => {
    const yesterday = await makeBooking(patient, {
      appointmentDate: normalizeToIstDay(new Date(Date.now() - 86400000)),
      checkedInAt: new Date(Date.now() - 86400000),
    });

    const tomorrow = await makeBooking(otherPatient, {
      appointmentDate: normalizeToIstDay(new Date(Date.now() + 86400000)),
      checkedInAt: new Date(),
    });

    const queue = await req("/nurse/queue", { token: nurseToken() });

    assert.equal(
      inQueue(queue.body, yesterday).length,
      0,
      "yesterday's patient is not on today's queue"
    );
    assert.equal(
      inQueue(queue.body, tomorrow).length,
      0,
      "tomorrow's patient is not on today's queue either"
    );
  });

  // A finished or abandoned visit is not clinical preparation.
  test("cancelled and completed visits are not on the queue", async () => {
    const cancelled = await makeBooking(patient, {
      status: "Cancelled",
      checkedInAt: new Date(),
      cancelledAt: new Date(),
    });

    const completed = await makeBooking(otherPatient, {
      status: "Completed",
      checkedInAt: new Date(),
      consultationStartedAt: new Date(),
      diagnosis: "automated test",
      prescription: "automated test",
    });

    const queue = await req("/nurse/queue", { token: nurseToken() });

    assert.equal(inQueue(queue.body, cancelled).length, 0);
    assert.equal(inQueue(queue.body, completed).length, 0);
  });

  // The queue is real data or it is nothing. An empty clinic must come back
  // as an empty list, never as something the screen can mistake for patients.
  test("an empty queue is an empty list, not a placeholder", async () => {
    await Appointment.deleteMany({ phone: { $in: [PHONE, OTHER_PHONE] } });

    const queue = await req("/nurse/queue", { token: nurseToken() });

    assert.equal(queue.status, 200);
    assert.ok(Array.isArray(queue.body.awaitingVitals));
    assert.ok(Array.isArray(queue.body.readyForDoctor));

    // Nothing this suite created is present. Other real patients may well be
    // checked in on the shared database, so this asserts on our own records
    // rather than on the list being globally empty.
    assert.equal(
      queue.body.awaitingVitals.filter((a) =>
        [PHONE, OTHER_PHONE].includes(a.phone)
      ).length,
      0
    );
  });

  // Authorization is not weakened by any of the above.
  test("only a nurse token can read the nurse's queue", async () => {
    const asReceptionist = await req("/nurse/queue", {
      token: receptionistToken(),
    });
    assert.equal(asReceptionist.status, 403);

    const asDoctor = await req("/nurse/queue", { token: doctorToken(doctor._id) });
    assert.equal(asDoctor.status, 403);

    const anonymous = await req("/nurse/queue");
    assert.equal(anonymous.status, 401);
  });
});
