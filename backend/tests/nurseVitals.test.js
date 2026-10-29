const { test, before, after, describe } = require("node:test");
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
const normalizeToIstDay = require("../utils/istDay").normalizeToIstDay;

// Vitals moved from the receptionist to the nurse. These cover the rules that
// would fail silently if the move were done halfway:
//
//   - a receptionist token can still reach a vitals endpoint
//   - BMI is accepted from the client instead of derived
//   - "ready for doctor" can be claimed with nothing measured
//
// Runs a real server against the real database, on its own port, and removes
// everything it creates. Test records use a reserved phone prefix so a failed
// run can never be confused with real data.
const PORT = 5098;
const BASE = `http://localhost:${PORT}`;
const PHONE = "9990000003";
const NURSE_EMAIL = "nurse.test.9990000003@example.invalid";

let child;
let doctor;
let patient;
let nurse;
let receptionist;

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
  return { status: res.status, body: json };
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

const doctorToken = () =>
  jwt.sign({ doctorId: String(doctor._id), role: "doctor" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

// A checked-in appointment for today, which is the only state the nurse works
// on. Slot is unique per run so a leftover row from a crashed run cannot
// collide with the partial unique index on {doctorId, appointmentDate, slot}.
async function makeCheckedInAppointment(overrides = {}) {
  return Appointment.create({
    patient: patient._id,
    patientName: "Nurse Vitals Probe",
    phone: PHONE,
    age: 41,
    gender: "Male",
    doctorId: doctor._id,
    appointmentDate: normalizeToIstDay(new Date()),
    slot: `nurse-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symptoms: "automated test",
    status: "Waiting",
    checkedInAt: new Date(),
    // An explicit token, like a real booking has. Without one, check-in
    // assigns the next token for this doctor and day - and `node --test` runs
    // files in parallel, so two suites checking in tokenless fixtures for the
    // same doctor could race on the unique token index, fail the check-in,
    // and leave the patient never reaching the nurse's queue. Every other
    // suite sets one for the same reason.
    tokenNumber: 5000 + Math.floor(Math.random() * 900),
    ...overrides,
  });
}

describe("nurse vitals", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    doctor = await Doctor.findOne({ isAvailable: true });
    receptionist = await Receptionist.findOne();

    assert.ok(doctor, "the database needs an available doctor to test with");
    assert.ok(receptionist, "the database needs a receptionist to test with");

    patient = await Patient.findOneAndUpdate(
      { phone: PHONE },
      {
        $setOnInsert: {
          name: "Nurse Vitals Probe",
          phone: PHONE,
          email: `probe.${PHONE}@example.invalid`,
          password: await bcrypt.hash("probe-password-not-real", 4),
        },
      },
      { upsert: true, new: true }
    );

    nurse = await Nurse.findOneAndUpdate(
      { email: NURSE_EMAIL },
      {
        $setOnInsert: {
          name: "Test Nurse",
          email: NURSE_EMAIL,
          password: await bcrypt.hash("probe-password-not-real", 4),
        },
      },
      { upsert: true, new: true }
    );

    child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });

    // Poll rather than sleep a fixed amount: the server has to connect to
    // Atlas first, and a fixed wait is either slow or flaky.
    for (let i = 0; i < 60; i++) {
      try {
        await fetch(BASE + "/consultation-time");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    throw new Error("the test server did not start");
  });

  after(async () => {
    await Appointment.deleteMany({ phone: PHONE });
    await Patient.deleteOne({ phone: PHONE });
    await Nurse.deleteOne({ email: NURSE_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("a nurse can record vitals, and BMI is derived not accepted", async () => {
    const appointment = await makeCheckedInAppointment();

    const res = await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: {
        heightCm: 170,
        weightKg: 72,
        bloodPressureSystolic: 120,
        bloodPressureDiastolic: 80,
        temperatureC: 36.8,
        pulseBpm: 76,
        spo2: 98,
        // Deliberately wrong. If the server ever trusts a client BMI, this
        // is the value that would be stored.
        bmi: 1,
      },
    });

    assert.equal(res.status, 200);

    const stored = await Appointment.findById(appointment._id);
    assert.equal(stored.vitals.heightCm, 170);
    assert.equal(stored.vitals.weightKg, 72);
    assert.equal(stored.vitals.bmi, 24.9, "BMI must be derived from height and weight");
    assert.equal(stored.vitals.bloodPressureSystolic, 120);
    assert.equal(stored.vitals.bloodPressureDiastolic, 80);
    assert.equal(stored.vitals.temperatureC, 36.8);
    assert.equal(stored.vitals.pulseBpm, 76);
    assert.equal(stored.vitals.spo2, 98);
    assert.equal(stored.vitals.recordedByModel, "Nurse");
  });

  test("checking a patient in puts them on the nurse's queue", async () => {
    // The receptionist -> nurse handoff, driven through the real endpoints in
    // the real order. Reported as broken; the backend half was not - this
    // pins it so a future filter change cannot quietly break it. What WAS
    // broken was the nurse screen never re-fetching (it now listens for the
    // "queueUpdated" socket event reception already emits).
    const appointment = await makeCheckedInAppointment({ checkedInAt: null });

    const before = await req("/nurse/queue", { token: nurseToken() });
    assert.ok(
      !before.body.awaitingVitals.some((a) => a._id === String(appointment._id)),
      "a booking nobody has arrived for is not the nurse's work"
    );

    const checkedIn = await req(
      `/receptionist/appointments/${appointment._id}/check-in`,
      { method: "PATCH", token: receptionistToken(), body: { priority: "Normal" } }
    );
    assert.equal(checkedIn.status, 200);

    const after = await req("/nurse/queue", { token: nurseToken() });
    assert.ok(
      after.body.awaitingVitals.some((a) => a._id === String(appointment._id)),
      "a checked-in patient must reach the nurse immediately"
    );

    // Recording vitals and handing over moves them between the two lists
    // rather than dropping them - looking only at "awaiting vitals" and
    // concluding the patient vanished is the other way this reads as broken.
    await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: { heightCm: 170, weightKg: 72 },
    });
    await req(`/nurse/appointments/${appointment._id}/ready`, {
      method: "PATCH",
      token: nurseToken(),
    });

    const handed = await req("/nurse/queue", { token: nurseToken() });
    assert.ok(
      !handed.body.awaitingVitals.some((a) => a._id === String(appointment._id))
    );
    assert.ok(
      handed.body.readyForDoctor.some((a) => a._id === String(appointment._id)),
      "handed over, not lost"
    );
  });

  test("a completed visit leaves the nurse's queue and cannot be re-prepared", async () => {
    // There is no check-out in this application (no checkedOutAt, no
    // endpoint, no status). "Completed" - set by the doctor - is the only
    // thing that closes a visit, so it is what must remove the patient from
    // the clinical queues and refuse further clinical work.
    const appointment = await makeCheckedInAppointment({
      status: "Completed",
      diagnosis: "automated test",
      prescription: "automated test",
      consultationStartedAt: new Date(),
    });

    const queue = await req("/nurse/queue", { token: nurseToken() });
    const ids = [
      ...queue.body.awaitingVitals,
      ...queue.body.readyForDoctor,
    ].map((a) => a._id);

    assert.ok(
      !ids.includes(String(appointment._id)),
      "a finished visit must not come back to the nurse"
    );

    const vitals = await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: { heightCm: 170, weightKg: 72 },
    });
    assert.equal(vitals.status, 400);

    const ready = await req(`/nurse/appointments/${appointment._id}/ready`, {
      method: "PATCH",
      token: nurseToken(),
    });
    assert.equal(ready.status, 400);
  });

  test("a nurse can correct vitals they already recorded", async () => {
    const appointment = await makeCheckedInAppointment();
    const token = nurseToken();

    await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token,
      body: { heightCm: 170, weightKg: 72 },
    });

    // The weight was typed as 82 by mistake and has to be fixable in place.
    const res = await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token,
      body: { heightCm: 170, weightKg: 82 },
    });

    assert.equal(res.status, 200);

    const stored = await Appointment.findById(appointment._id);
    assert.equal(stored.vitals.weightKg, 82);
    assert.equal(stored.vitals.bmi, 28.4, "BMI must follow the correction");
  });

  test("half a paired measurement is refused", async () => {
    const appointment = await makeCheckedInAppointment();

    const noWeight = await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: { heightCm: 170 },
    });
    assert.equal(noWeight.status, 400);

    const halfBp = await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: { heightCm: 170, weightKg: 72, bloodPressureSystolic: 120 },
    });
    assert.equal(halfBp.status, 400);

    const stored = await Appointment.findById(appointment._id);
    assert.equal(stored.vitals.heightCm, null, "a refused write must store nothing");
  });

  test("a receptionist cannot record or correct vitals", async () => {
    const appointment = await makeCheckedInAppointment();

    // The endpoint the receptionist used to own is gone.
    const oldRoute = await req(
      `/receptionist/appointments/${appointment._id}/vitals`,
      {
        method: "PATCH",
        token: receptionistToken(),
        body: { heightCm: 170, weightKg: 72 },
      }
    );
    assert.notEqual(oldRoute.status, 200, "the receptionist vitals route must not exist");

    // And the nurse endpoint refuses a receptionist token.
    const nurseRoute = await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: receptionistToken(),
      body: { heightCm: 170, weightKg: 72 },
    });
    assert.equal(nurseRoute.status, 403);

    const stored = await Appointment.findById(appointment._id);
    assert.equal(stored.vitals.heightCm, null);
  });

  test("check-in ignores vitals sent by a receptionist", async () => {
    const appointment = await makeCheckedInAppointment({ checkedInAt: null });

    const res = await req(
      `/receptionist/appointments/${appointment._id}/check-in`,
      {
        method: "PATCH",
        token: receptionistToken(),
        body: { priority: "Normal", heightCm: 170, weightKg: 72 },
      }
    );

    assert.equal(res.status, 200, "check-in itself must still work");

    const stored = await Appointment.findById(appointment._id);
    assert.ok(stored.checkedInAt, "the patient should be checked in");
    assert.equal(stored.vitals.heightCm, null, "no clinical measurement may be written");
    assert.equal(stored.vitals.bmi, null);
  });

  test("ready for doctor requires a measurement, and the doctor sees the vitals", async () => {
    const appointment = await makeCheckedInAppointment();
    const token = nurseToken();

    const tooEarly = await req(`/nurse/appointments/${appointment._id}/ready`, {
      method: "PATCH",
      token,
    });
    assert.equal(tooEarly.status, 400, "an unmeasured patient is not prepared");

    await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token,
      body: { heightCm: 170, weightKg: 72 },
    });

    const ready = await req(`/nurse/appointments/${appointment._id}/ready`, {
      method: "PATCH",
      token,
    });
    assert.equal(ready.status, 200);

    const stored = await Appointment.findById(appointment._id);
    assert.ok(stored.readyForDoctorAt, "the hand-off should be stamped");

    // The doctor's consultation screen loads the appointment through
    // GET /appointments/:id (see AppointmentDetails.jsx) and renders its
    // Vitals panel from what comes back. Vitals reaching the nurse but not
    // the doctor would make the whole hand-off pointless.
    //
    // Not asserted against /doctor/live-queue: that endpoint deliberately
    // projects only the queue columns (token, name, priority, status, slot)
    // and never carried vitals.
    const seen = await req(`/appointments/${appointment._id}`, {
      token: doctorToken(),
    });

    assert.equal(seen.status, 200);

    const asDoctorSeesIt = seen.body.appointment || seen.body;
    assert.equal(
      asDoctorSeesIt.vitals.bmi,
      24.9,
      "the doctor must see the derived BMI"
    );
    assert.equal(asDoctorSeesIt.vitals.spo2 ?? null, null);
    assert.ok(asDoctorSeesIt.readyForDoctorAt, "the doctor must see the hand-off");
  });

  test("a nurse cannot change vitals on a completed consultation", async () => {
    const appointment = await makeCheckedInAppointment({
      status: "Completed",
      diagnosis: "automated test",
      prescription: "automated test",
      consultationStartedAt: new Date(),
    });

    const res = await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: { heightCm: 170, weightKg: 72 },
    });

    assert.equal(res.status, 400);
  });
  // The whole hand-off, end to end, with EVERY measurement the nurse can
  // take. The narrower tests above each cover one rule; this one exists
  // because the chain is what actually has to work - a link can be correct in
  // isolation and still not carry the data to the doctor.
  test("every recorded vital reaches the doctor with its provenance", async () => {
    const appointment = await makeCheckedInAppointment();
    const token = nurseToken();

    // The patient must reach the nurse before anything can be recorded.
    const queue = await req("/nurse/queue", { token });
    assert.equal(queue.status, 200);
    assert.ok(
      queue.body.awaitingVitals.some(
        (a) => String(a._id) === String(appointment._id)
      ),
      "a checked-in patient must be on the nurse's queue"
    );

    const recorded = await req(
      `/nurse/appointments/${appointment._id}/vitals`,
      {
        method: "PATCH",
        token,
        body: {
          heightCm: 170,
          weightKg: 68,
          bloodPressureSystolic: 120,
          bloodPressureDiastolic: 80,
          temperatureC: 37,
          pulseBpm: 76,
          spo2: 98,
          respiratoryRate: 16,
        },
      }
    );
    assert.equal(recorded.status, 200, recorded.body.message);

    await req(`/nurse/appointments/${appointment._id}/ready`, {
      method: "PATCH",
      token,
    });

    const seen = await req(`/appointments/${appointment._id}`, {
      token: doctorToken(),
    });
    assert.equal(seen.status, 200);

    const v = seen.body.appointment.vitals;

    assert.equal(v.heightCm, 170);
    assert.equal(v.weightKg, 68);
    assert.equal(v.bmi, 23.5, "BMI is derived, not sent");
    assert.equal(v.bloodPressureSystolic, 120);
    assert.equal(v.bloodPressureDiastolic, 80);
    assert.equal(v.temperatureC, 37);
    assert.equal(v.pulseBpm, 76);
    assert.equal(v.spo2, 98);
    assert.equal(v.respiratoryRate, 16);

    // Provenance, so the doctor's screen cannot imply the doctor took these.
    assert.equal(v.recordedByModel, "Nurse", "the source must be the nurse");
    assert.equal(String(v.recordedBy), String(nurse._id));
    assert.ok(v.recordedAt, "the time of measurement must be stored");

    // Same appointment throughout - no second copy anywhere.
    assert.equal(
      String(seen.body.appointment._id),
      String(appointment._id),
      "the vitals must belong to the appointment they were recorded against"
    );
  });

  // The regression for the doctor's panel. Height and weight are the only
  // PAIR the nurse must take together; everything else stands alone, so a
  // patient who is measured but not weighed has a full set of observations
  // and no BMI. The doctor's screen keyed its entire panel on BMI, so all of
  // these were hidden - the reading was taken, stored, returned by the API,
  // and simply not shown.
  test("vitals without height and weight still reach the doctor", async () => {
    const appointment = await makeCheckedInAppointment();

    const recorded = await req(
      `/nurse/appointments/${appointment._id}/vitals`,
      {
        method: "PATCH",
        token: nurseToken(),
        body: {
          bloodPressureSystolic: 138,
          bloodPressureDiastolic: 88,
          temperatureC: 38.4,
          pulseBpm: 104,
          spo2: 94,
          respiratoryRate: 22,
        },
      }
    );
    assert.equal(recorded.status, 200, recorded.body.message);

    const seen = await req(`/appointments/${appointment._id}`, {
      token: doctorToken(),
    });

    const v = seen.body.appointment.vitals;

    assert.equal(v.bmi, null, "no height or weight means no BMI");
    assert.equal(v.temperatureC, 38.4);
    assert.equal(v.pulseBpm, 104);
    assert.equal(v.spo2, 94);
    assert.equal(v.respiratoryRate, 22);
    assert.ok(
      v.recordedAt,
      "a recording with no BMI is still a recording"
    );
  });

  test("a respiratory rate outside the plausible range is refused", async () => {
    const appointment = await makeCheckedInAppointment();

    const res = await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: { respiratoryRate: 300 },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /respiratory rate/i);
  });

  // Vitals are clinical data about ONE patient. The appointment endpoint is
  // scoped to the doctor who owns it, so another doctor cannot read them.
  test("another doctor cannot read this patient's vitals", async () => {
    const appointment = await makeCheckedInAppointment();

    await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token: nurseToken(),
      body: { heightCm: 170, weightKg: 68 },
    });

    const otherDoctorId = new mongoose.Types.ObjectId();
    const otherToken = jwt.sign(
      { doctorId: String(otherDoctorId), role: "doctor" },
      process.env.JWT_SECRET,
      { expiresIn: "1h" }
    );

    const seen = await req(`/appointments/${appointment._id}`, {
      token: otherToken,
    });

    assert.equal(seen.status, 403, "clinical data must not leak across doctors");
  });

  // Clearing the panel withdraws the hand-off, so the doctor is never shown
  // "ready" over an empty assessment.
  test("clearing vitals withdraws the hand-off the doctor sees", async () => {
    const appointment = await makeCheckedInAppointment();
    const token = nurseToken();

    await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token,
      body: { heightCm: 170, weightKg: 68 },
    });
    await req(`/nurse/appointments/${appointment._id}/ready`, {
      method: "PATCH",
      token,
    });

    await req(`/nurse/appointments/${appointment._id}/vitals`, {
      method: "PATCH",
      token,
      body: {},
    });

    const seen = await req(`/appointments/${appointment._id}`, {
      token: doctorToken(),
    });

    assert.equal(seen.body.appointment.readyForDoctorAt, null);
    assert.equal(seen.body.appointment.vitals.recordedByModel ?? null, null);
    assert.equal(seen.body.appointment.vitals.recordedAt ?? null, null);
  });
});
