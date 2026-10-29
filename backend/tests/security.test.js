const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");
const crypto = require("node:crypto");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const generateSlots = require("../utils/generateSlots");

const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const Appointment = require("../models/Appointment");

// These cover the access-control rules, not the happy paths - they are the
// parts that fail silently and dangerously. Every one of them corresponds to a
// bug that either existed or was one refactor away:
//
//   - the report endpoint shipped with no authentication at all
//   - reschedule wrote a status value the schema did not allow
//   - the reset endpoint leaked account existence through response timing
//
// The suite drives a real server against the real database and removes
// everything it creates. Test records use a reserved phone prefix so a failed
// run can never be confused with real data.
const PORT = 5099;
const BASE = `http://localhost:${PORT}`;
const PHONE_A = "9990000001";
const PHONE_B = "9990000002";
const TEST_PHONES = [PHONE_A, PHONE_B];

let child;

function tokenFor(patient) {
  return jwt.sign(
    { patientId: patient._id, phone: patient.phone, role: "patient" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function req(pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, raw: text };
}

async function waitForServer(timeoutMs = 40000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/hospitals`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("server did not start in time");
}

async function cleanup() {
  await Appointment.deleteMany({ phone: { $in: TEST_PHONES } });
  await Patient.deleteMany({ phone: { $in: TEST_PHONES } });
}

async function makePatient(phone, email) {
  await Patient.deleteOne({ phone });
  return Patient.create({
    name: `Test ${phone}`,
    phone,
    email,
    password: await bcrypt.hash("originalpass1", 10),
  });
}

// (doctorId, appointmentDate, slot) is uniquely indexed, so every fixture gets
// its own day unless the caller pins one deliberately.
let dayOffset = 3;

async function makeAppointment(patient, doctor, overrides = {}) {
  const date = new Date();
  date.setDate(date.getDate() + (dayOffset += 1));
  return Appointment.create({
    patient: patient._id,
    doctorId: doctor._id,
    patientName: patient.name,
    age: 30,
    phone: patient.phone,
    symptoms: "test",
    appointmentDate: date,
    slot: "10:00 AM",
    status: "Waiting",
    ...overrides,
  });
}

before(async () => {
  // PORT is overridden so a dev server on 5000 can stay running.
  child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: "ignore",
  });
  await mongoose.connect(process.env.MONGO_URI);
  await waitForServer();
  await cleanup();
});

after(async () => {
  await cleanup();
  await mongoose.disconnect();
  child?.kill();
});

describe("password reset", () => {
  test("does not reveal whether an email is registered", async () => {
    const known = await req("/patient/forgot-password", {
      method: "POST",
      body: { email: process.env.TEST_KNOWN_PATIENT_EMAIL || "demo.patient@example.com" },
    });
    const unknown = await req("/patient/forgot-password", {
      method: "POST",
      body: { email: "definitely-not-registered-zz@example.com" },
    });

    assert.equal(known.status, unknown.status);
    assert.deepEqual(known.body, unknown.body);
  });

  test("stores only a hash of the token, with an expiry", async () => {
    const patient = await makePatient(PHONE_A, "reset-a@example.com");
    await req("/patient/forgot-password", {
      method: "POST",
      body: { email: "reset-a@example.com" },
    });

    const stored = await Patient.findById(patient._id).select("+resetTokenHash +resetTokenExpires");
    assert.match(stored.resetTokenHash, /^[a-f0-9]{64}$/, "token must be a sha256 hash");
    assert.ok(stored.resetTokenExpires > new Date(), "expiry must be in the future");
  });

  test("rejects a token that was not issued", async () => {
    await makePatient(PHONE_A, "reset-a@example.com");
    const res = await req("/patient/reset-password", {
      method: "POST",
      body: { email: "reset-a@example.com", token: "deadbeef", newPassword: "newpassword1" },
    });
    assert.equal(res.status, 400);
  });

  test("rejects a password below the minimum length", async () => {
    await makePatient(PHONE_A, "reset-a@example.com");
    const res = await req("/patient/reset-password", {
      method: "POST",
      body: { email: "reset-a@example.com", token: "whatever", newPassword: "short" },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /8 characters/);
  });

  test("a token works once and is then rejected", async () => {
    const patient = await makePatient(PHONE_A, "reset-a@example.com");

    // Mirror how the server derives the stored hash so the emailed plaintext
    // can be reconstructed here without reading the message.
    const plaintext = crypto.randomBytes(32).toString("hex");
    patient.resetTokenHash = crypto.createHash("sha256").update(plaintext).digest("hex");
    patient.resetTokenExpires = new Date(Date.now() + 60 * 60 * 1000);
    await patient.save();

    const first = await req("/patient/reset-password", {
      method: "POST",
      body: { email: "reset-a@example.com", token: plaintext, newPassword: "brandnewpass1" },
    });
    assert.equal(first.status, 200);

    const replay = await req("/patient/reset-password", {
      method: "POST",
      body: { email: "reset-a@example.com", token: plaintext, newPassword: "anotherpass12" },
    });
    assert.equal(replay.status, 400, "a used token must not work a second time");

    const after = await Patient.findById(patient._id).select("+password");
    assert.ok(await bcrypt.compare("brandnewpass1", after.password), "password should be updated");
  });

  test("an expired token is rejected", async () => {
    const patient = await makePatient(PHONE_A, "reset-a@example.com");
    const plaintext = crypto.randomBytes(32).toString("hex");
    patient.resetTokenHash = crypto.createHash("sha256").update(plaintext).digest("hex");
    patient.resetTokenExpires = new Date(Date.now() - 1000);
    await patient.save();

    const res = await req("/patient/reset-password", {
      method: "POST",
      body: { email: "reset-a@example.com", token: plaintext, newPassword: "brandnewpass1" },
    });
    assert.equal(res.status, 400);
  });
});

describe("appointment ownership", () => {
  test("a patient cannot cancel someone else's appointment", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "own-a@example.com");
    const b = await makePatient(PHONE_B, "own-b@example.com");
    const theirs = await makeAppointment(b, doctor, { slot: "09:00 AM" });

    const res = await req(`/patient/appointments/${theirs._id}/cancel`, {
      method: "PATCH",
      token: tokenFor(a),
    });
    assert.equal(res.status, 403);

    const untouched = await Appointment.findById(theirs._id);
    assert.equal(untouched.status, "Waiting", "the other patient's appointment must be unchanged");
  });

  test("cancelling requires a token", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "own-a@example.com");
    const appt = await makeAppointment(a, doctor);

    const res = await req(`/patient/appointments/${appt._id}/cancel`, { method: "PATCH" });
    assert.equal(res.status, 401);
  });

  test("a completed appointment cannot be cancelled", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "own-a@example.com");
    const appt = await makeAppointment(a, doctor, {
      status: "Completed",
      diagnosis: "dx",
      prescription: "rx",
    });

    const res = await req(`/patient/appointments/${appt._id}/cancel`, {
      method: "PATCH",
      token: tokenFor(a),
    });
    assert.equal(res.status, 400);
  });

  test("rescheduling into the past is refused", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "own-a@example.com");
    const appt = await makeAppointment(a, doctor);

    const res = await req(`/patient/appointments/${appt._id}/reschedule`, {
      method: "PATCH",
      token: tokenFor(a),
      body: { appointmentDate: "2020-01-01", slot: "11:00 AM" },
    });
    assert.equal(res.status, 400);
  });

  test("rescheduling onto a taken slot is refused", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "own-a@example.com");
    const b = await makePatient(PHONE_B, "own-b@example.com");

    const when = new Date();
    when.setDate(when.getDate() + 8);
    await makeAppointment(b, doctor, { appointmentDate: when, slot: "02:00 PM" });
    const mine = await makeAppointment(a, doctor, { slot: "03:00 PM" });

    const res = await req(`/patient/appointments/${mine._id}/reschedule`, {
      method: "PATCH",
      token: tokenFor(a),
      body: { appointmentDate: when.toISOString(), slot: "02:00 PM" },
    });
    assert.equal(res.status, 409);
  });

  test("a valid reschedule sets a status the schema allows and re-issues the token", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "own-a@example.com");
    const appt = await makeAppointment(a, doctor, { tokenNumber: 4, status: "Waiting" });

    const when = new Date();
    when.setDate(when.getDate() + 11);

    // Take a slot the doctor actually offers rather than a hardcoded time:
    // reschedule now validates the slot against the doctor's schedule, the
    // way booking always has.
    const validSlots = generateSlots(
      doctor.workingHours.start,
      doctor.workingHours.end,
      doctor.slotDuration
    );
    const target = validSlots[validSlots.length - 1];

    const res = await req(`/patient/appointments/${appt._id}/reschedule`, {
      method: "PATCH",
      token: tokenFor(a),
      body: { appointmentDate: when.toISOString(), slot: target },
    });
    assert.equal(res.status, 200, res.raw);

    const moved = await Appointment.findById(appt._id);
    assert.equal(moved.slot, target);
    // The token is re-issued for the new day, not cleared: tokens are handed
    // out at booking so the patient stays visible in the queue and can open
    // their waiting-room page, which is routed on the token.
    assert.ok(moved.tokenNumber != null, "a moved appointment must still hold a queue position");
    // A moved appointment has not been arrived for; check-in gates on this.
    assert.ok(!moved.checkedInAt, "checkedInAt must not survive a move");
    // Guards against reintroducing a status outside the schema's enum.
    assert.ok(
      ["Waiting", "In Consultation", "Completed", "Cancelled"].includes(moved.status),
      `unexpected status ${moved.status}`
    );
  });

  test("a reschedule onto a slot the doctor does not offer is refused", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "own-a@example.com");
    const appt = await makeAppointment(a, doctor, { tokenNumber: 5, status: "Waiting" });

    const when = new Date();
    when.setDate(when.getDate() + 12);

    const res = await req(`/patient/appointments/${appt._id}/reschedule`, {
      method: "PATCH",
      token: tokenFor(a),
      body: { appointmentDate: when.toISOString(), slot: "99:99 ZZ" },
    });
    assert.equal(res.status, 400, res.raw);
  });
});

describe("medical report download", () => {
  test("requires a token", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "rep-a@example.com");
    const appt = await makeAppointment(a, doctor, {
      status: "Completed",
      diagnosis: "dx",
      prescription: "rx",
    });

    const res = await req(`/patient/appointments/${appt._id}/report`);
    assert.equal(res.status, 401);
  });

  test("another patient cannot download it", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "rep-a@example.com");
    const b = await makePatient(PHONE_B, "rep-b@example.com");
    const appt = await makeAppointment(a, doctor, {
      status: "Completed",
      diagnosis: "dx",
      prescription: "rx",
    });

    const res = await req(`/patient/appointments/${appt._id}/report`, { token: tokenFor(b) });
    assert.equal(res.status, 403);
  });

  test("the owner can download it", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "rep-a@example.com");
    const appt = await makeAppointment(a, doctor, {
      status: "Completed",
      diagnosis: "dx",
      prescription: "rx",
    });

    const res = await fetch(`${BASE}/patient/appointments/${appt._id}/report`, {
      headers: { Authorization: `Bearer ${tokenFor(a)}` },
    });
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") || "", /pdf/);
  });

  test("the old unauthenticated route is gone", async () => {
    const doctor = await Doctor.findOne();
    const a = await makePatient(PHONE_A, "rep-a@example.com");
    const appt = await makeAppointment(a, doctor, {
      status: "Completed",
      diagnosis: "dx",
      prescription: "rx",
    });

    const res = await req(`/appointments/${appt._id}/patient-report?phone=${a.phone}`);
    assert.equal(res.status, 404, "the pre-auth report route must not come back");
  });
});

describe("cross-origin policy", () => {
  test("an unlisted origin is refused", async () => {
    const res = await fetch(`${BASE}/hospitals`, { headers: { Origin: "https://evil.example" } });
    assert.equal(res.status, 403);
  });

  // Capacitor's androidScheme defaults to https, so the installed Android app
  // presents https://localhost. Leaving it out of the allowlist 403s every
  // request the app makes while the browser build carries on working, which is
  // exactly how it slipped through the first time.
  for (const origin of [
    "https://localhost",
    "capacitor://localhost",
    "ionic://localhost",
    "http://localhost",
  ]) {
    test(`the native origin ${origin} is allowed`, async () => {
      const res = await fetch(`${BASE}/hospitals`, { headers: { Origin: origin } });
      assert.equal(res.status, 200);
    });
  }

  test("a request with no origin is allowed", async () => {
    const res = await fetch(`${BASE}/hospitals`);
    assert.equal(res.status, 200);
  });
});
