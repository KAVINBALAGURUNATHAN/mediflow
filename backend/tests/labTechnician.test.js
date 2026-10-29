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
const Appointment = require("../models/Appointment");
const LabTest = require("../models/LabTest");
const LabOrder = require("../models/LabOrder");
const LabTechnician = require("../models/LabTechnician");
const LabResult = require("../models/LabResult");
const { normalizeToIstDay } = require("../utils/istDay");

// The lab technician picks up orders doctors have placed.
//
// What would silently break the feature:
//
//   - the worklist is scoped to today, so yesterday's outstanding sample
//     vanishes and is never run
//   - a withdrawn or already-reported order can be restarted
//   - any role with a token can reach the worklist
//   - the technician can read clinical detail they have no business seeing
//
// Runs a real server against the real database, on its own port, and removes
// everything it creates.
const PORT = 5092;
const BASE = `http://localhost:${PORT}`;
const PHONE = "9990000005";
const TECH_EMAIL = "tech.test.9990000005@example.invalid";

let child;
let doctor;
let patient;
let technician;
let catalogTest;

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

const techToken = () =>
  jwt.sign(
    { labTechnicianId: String(technician._id), role: "labTechnician" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

const doctorToken = () =>
  jwt.sign({ doctorId: String(doctor._id), role: "doctor" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

async function makeOrder(overrides = {}, appointmentOverrides = {}) {
  const appointment = await Appointment.create({
    patient: patient._id,
    patientName: "Lab Tech Probe",
    phone: PHONE,
    age: 52,
    gender: "Male",
    doctorId: doctor._id,
    appointmentDate: normalizeToIstDay(new Date()),
    slot: `tech-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symptoms: "automated test",
    status: "Waiting",
    checkedInAt: new Date(),
    ...appointmentOverrides,
  });

  const order = await LabOrder.create({
    appointmentId: appointment._id,
    patientId: patient._id,
    doctorId: doctor._id,
    labTestId: catalogTest._id,
    ...overrides,
  });

  return { appointment, order };
}

describe("lab technician worklist", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    doctor = await Doctor.findOne();
    assert.ok(doctor, "the database needs a doctor to test with");

    catalogTest = await LabTest.findOne({ name: "Complete Blood Count" });
    assert.ok(
      catalogTest,
      "the demo catalog must be seeded - run scripts/seedLabTests.js"
    );

    patient = await Patient.findOneAndUpdate(
      { phone: PHONE },
      {
        $setOnInsert: {
          name: "Lab Tech Probe",
          phone: PHONE,
          email: `probe.${PHONE}@example.invalid`,
          password: await bcrypt.hash("probe-password-not-real", 4),
        },
      },
      { upsert: true, new: true }
    );

    technician = await LabTechnician.findOneAndUpdate(
      { email: TECH_EMAIL },
      {
        $setOnInsert: {
          name: "Test Technician",
          email: TECH_EMAIL,
          password: await bcrypt.hash("probe-password-not-real", 4),
        },
      },
      { upsert: true, new: true }
    );

    child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      env: { ...process.env, PORT: String(PORT) },
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

    throw new Error("the test server did not start");
  });

  after(async () => {
    const appointments = await Appointment.find({ phone: PHONE }).select("_id");
    await LabOrder.deleteMany({
      appointmentId: { $in: appointments.map((a) => a._id) },
    });
    await LabResult.deleteMany({ patientId: patient._id });
    await Appointment.deleteMany({ phone: PHONE });
    await Patient.deleteOne({ phone: PHONE });
    await LabTechnician.deleteOne({ email: TECH_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("the technician sees pending orders with the patient, test and doctor", async () => {
    const { order } = await makeOrder();

    const res = await req("/lab-technician/worklist", { token: techToken() });

    assert.equal(res.status, 200);

    const mine = res.body.pending.find((o) => o._id === String(order._id));
    assert.ok(mine, "a newly ordered test should be pending");

    // The four columns the worklist renders.
    assert.equal(mine.patientId.name, "Lab Tech Probe");
    assert.equal(mine.labTestId.name, "Complete Blood Count");
    assert.equal(mine.doctorId.name, doctor.name);
    assert.equal(mine.status, "Ordered");

    // The parameters come from the definition, so the technician never types
    // them - this is what Phase 5's generated form is built from.
    assert.ok(mine.labTestId.parameters.some((p) => p.name === "Haemoglobin"));

    // Clinical detail the lab has no business reading is not sent at all,
    // rather than hidden in the UI.
    assert.equal(mine.appointmentId.diagnosis, undefined);
    assert.equal(mine.appointmentId.symptoms, undefined);
    assert.equal(mine.patientId.phone, undefined);
  });

  test("the worklist is not scoped to today", async () => {
    // A sample drawn yesterday afternoon may legitimately still be
    // outstanding. If the worklist only looked at today, it would silently
    // never be run.
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    // tokenNumber matters here. `expireStaleWaitingAppointments()` on server
    // startup cancels past-day "Waiting" appointments whose tokenNumber is
    // null - which the handoff calls dead code because real bookings always
    // have a token. A fixture without one DOES match it, so the appointment
    // was being cancelled underneath this test and then correctly dropped by
    // the cancelled-visit filter. Booking assigns a token, so setting one
    // here is what makes the fixture realistic, not a workaround.
    const { order } = await makeOrder(
      { orderedAt: yesterday },
      {
        appointmentDate: normalizeToIstDay(yesterday),
        tokenNumber: 9901,
      }
    );

    const res = await req("/lab-technician/worklist", { token: techToken() });

    assert.ok(
      res.body.pending.some((o) => o._id === String(order._id)),
      "yesterday's outstanding order must still appear"
    );
  });

  test("starting a test moves it from Ordered to In Progress", async () => {
    const { order } = await makeOrder();

    const res = await req(`/lab-technician/lab-orders/${order._id}/start`, {
      method: "PATCH",
      token: techToken(),
    });

    assert.equal(res.status, 200);

    const stored = await LabOrder.findById(order._id);
    assert.equal(stored.status, "In Progress");
    assert.ok(stored.startedAt, "the pick-up time should be stamped");
    assert.equal(String(stored.startedBy), String(technician._id));

    // And it moves between the two lists.
    const after = await req("/lab-technician/worklist", { token: techToken() });
    assert.ok(!after.body.pending.some((o) => o._id === String(order._id)));
    assert.ok(after.body.inProgress.some((o) => o._id === String(order._id)));
  });

  test("starting an already-started test changes nothing", async () => {
    const { order } = await makeOrder();
    const token = techToken();

    await req(`/lab-technician/lab-orders/${order._id}/start`, {
      method: "PATCH",
      token,
    });

    const first = await LabOrder.findById(order._id);

    // Two technicians clicking the same row is a race, not a mistake, so this
    // is idempotent - but the pick-up time must not move, or the record would
    // claim the sample waited less than it did.
    const again = await req(`/lab-technician/lab-orders/${order._id}/start`, {
      method: "PATCH",
      token,
    });

    assert.equal(again.status, 200);
    assert.match(again.body.message, /already in progress/i);

    const second = await LabOrder.findById(order._id);
    assert.equal(
      second.startedAt.getTime(),
      first.startedAt.getTime(),
      "the pick-up time must not move"
    );
  });

  test("a withdrawn or reported order cannot be started", async () => {
    const withdrawn = await makeOrder({ status: "Cancelled" });
    const reported = await makeOrder({ status: "Completed" });

    const onWithdrawn = await req(
      `/lab-technician/lab-orders/${withdrawn.order._id}/start`,
      { method: "PATCH", token: techToken() }
    );
    assert.equal(onWithdrawn.status, 400);
    assert.match(onWithdrawn.body.message, /withdrawn/i);

    const onReported = await req(
      `/lab-technician/lab-orders/${reported.order._id}/start`,
      { method: "PATCH", token: techToken() }
    );
    assert.equal(onReported.status, 400);

    assert.equal(
      (await LabOrder.findById(withdrawn.order._id)).status,
      "Cancelled"
    );
    assert.equal(
      (await LabOrder.findById(reported.order._id)).status,
      "Completed"
    );

    // Neither appears on the worklist in the first place.
    const worklist = await req("/lab-technician/worklist", {
      token: techToken(),
    });
    const ids = [...worklist.body.pending, ...worklist.body.inProgress].map(
      (o) => o._id
    );
    assert.ok(!ids.includes(String(withdrawn.order._id)));
    assert.ok(!ids.includes(String(reported.order._id)));
  });

  test("an order on a cancelled visit leaves the worklist and cannot be started", async () => {
    const { appointment, order } = await makeOrder();

    // Cancelling the APPOINTMENT does not touch its orders, so without an
    // explicit rule the lab would keep a sample on the bench for a patient
    // who went home.
    appointment.status = "Cancelled";
    await appointment.save();

    const worklist = await req("/lab-technician/worklist", {
      token: techToken(),
    });

    const ids = [...worklist.body.pending, ...worklist.body.inProgress].map(
      (o) => o._id
    );
    assert.ok(
      !ids.includes(String(order._id)),
      "a test for a cancelled visit must not be on the worklist"
    );

    // And it must be genuinely refused, not merely hidden - the id is still
    // guessable.
    const started = await req(`/lab-technician/lab-orders/${order._id}/start`, {
      method: "PATCH",
      token: techToken(),
    });

    assert.equal(started.status, 400);
    assert.match(started.body.message, /cancelled/i);
    assert.equal((await LabOrder.findById(order._id)).status, "Ordered");
  });

  test("bad ids are refused", async () => {
    assert.equal(
      (
        await req("/lab-technician/lab-orders/not-an-id/start", {
          method: "PATCH",
          token: techToken(),
        })
      ).status,
      400
    );

    assert.equal(
      (
        await req(
          `/lab-technician/lab-orders/${new mongoose.Types.ObjectId()}/start`,
          { method: "PATCH", token: techToken() }
        )
      ).status,
      404
    );
  });

  test("no other role can reach the worklist or start a test", async () => {
    const { order } = await makeOrder();

    // A doctor holds a perfectly valid token - for a different role. The
    // worklist is cross-patient, so this is the boundary that stops one
    // role's credential reading every patient's outstanding tests.
    const doctorRead = await req("/lab-technician/worklist", {
      token: doctorToken(),
    });
    assert.equal(doctorRead.status, 403);

    const doctorStart = await req(
      `/lab-technician/lab-orders/${order._id}/start`,
      { method: "PATCH", token: doctorToken() }
    );
    assert.equal(doctorStart.status, 403);

    const anonymous = await req("/lab-technician/worklist");
    assert.equal(anonymous.status, 401);

    const garbage = await req("/lab-technician/worklist", { token: "nonsense" });
    assert.equal(garbage.status, 401);

    assert.equal(
      (await LabOrder.findById(order._id)).status,
      "Ordered",
      "nothing refused may have changed the order"
    );
  });

  test("login issues a technician token and does not leak account existence", async () => {
    const unknown = await req("/lab-technician/login", {
      method: "POST",
      body: { email: "nobody@example.invalid", password: "whatever12" },
    });

    const wrongPassword = await req("/lab-technician/login", {
      method: "POST",
      body: { email: TECH_EMAIL, password: "definitely-wrong" },
    });

    assert.equal(unknown.status, 401);
    assert.equal(wrongPassword.status, 401);
    assert.equal(
      unknown.body.message,
      wrongPassword.body.message,
      "an unknown email and a wrong password must be indistinguishable"
    );

    const ok = await req("/lab-technician/login", {
      method: "POST",
      body: { email: TECH_EMAIL, password: "probe-password-not-real" },
    });

    assert.equal(ok.status, 200);
    assert.equal(ok.body.labTechnician.role, "labTechnician");
    assert.equal(ok.body.labTechnician.password, undefined);

    // The issued token really works on the worklist.
    const worklist = await req("/lab-technician/worklist", {
      token: ok.body.token,
    });
    assert.equal(worklist.status, 200);
  });
});
