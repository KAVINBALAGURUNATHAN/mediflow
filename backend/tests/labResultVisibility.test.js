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
const LabResult = require("../models/LabResult");
const LabTechnician = require("../models/LabTechnician");
const { normalizeToIstDay } = require("../utils/istDay");

// Who may SEE a completed lab result, and who may change it.
//
// The failures these exist to catch:
//
//   - the ordering doctor cannot see a result of a test they ordered
//   - another doctor can
//   - a patient sees readings before the lab has finalised them
//   - a patient can edit, delete or re-status their own result
//   - the ordering DOCTOR can rewrite what the laboratory reported
//
// The last one is the subtle one. `PATCH /doctor/lab-results/:id` predates the
// technician role, when the ordering doctor was the only person who could
// enter values, so it accepted arbitrary parameters, units and ranges.
const PORT = 5087;
const BASE = `http://localhost:${PORT}`;
const PHONE_A = "9990000007";
const PHONE_B = "9990000008";
const TECH_EMAIL = "visibility.9990000007@example.invalid";

let child;
let doctor;
let otherDoctor;
let patientA;
let patientB;
let technician;
let thyroid;

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

const docToken = (d) =>
  jwt.sign({ doctorId: String(d._id), role: "doctor" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

const patToken = (p) =>
  jwt.sign(
    { patientId: String(p._id), phone: p.phone, role: "patient" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

const techToken = () =>
  jwt.sign(
    { labTechnicianId: String(technician._id), role: "labTechnician" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

// Builds the whole chain the way the app does: order, start, report.
async function reportedResult({ patient, complete = true } = {}) {
  const appointment = await Appointment.create({
    patient: patient._id,
    patientName: patient.name,
    phone: patient.phone,
    age: 47,
    gender: "Male",
    doctorId: doctor._id,
    appointmentDate: normalizeToIstDay(new Date()),
    slot: `vis-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symptoms: "automated test",
    status: "Waiting",
    checkedInAt: new Date(),
  });

  const order = await LabOrder.create({
    appointmentId: appointment._id,
    patientId: patient._id,
    doctorId: doctor._id,
    labTestId: thyroid._id,
    status: "In Progress",
    startedAt: new Date(),
  });

  await req(`/lab-technician/lab-orders/${order._id}/result`, {
    method: "PATCH",
    token: techToken(),
    body: {
      values: { TSH: "2.1", T3: "120", T4: "8.0" },
      flags: { TSH: "High" },
      summary: "Slightly raised TSH",
      complete,
    },
  });

  const result = await LabResult.findOne({ labOrderId: order._id });
  return { appointment, order, result };
}

describe("lab result visibility", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const doctors = await Doctor.find().limit(2);
    doctor = doctors[0];
    otherDoctor = doctors[1];

    assert.ok(doctor, "the database needs a doctor to test with");
    assert.ok(otherDoctor, "the database needs a SECOND doctor");

    thyroid = await LabTest.findOne({ name: "Thyroid Profile" });
    assert.ok(thyroid, "the demo catalog must be seeded");

    const makePatient = async (phone, name) =>
      Patient.findOneAndUpdate(
        { phone },
        {
          $setOnInsert: {
            name,
            phone,
            email: `probe.${phone}@example.invalid`,
            password: await bcrypt.hash("probe-password-not-real", 4),
          },
        },
        { upsert: true, new: true }
      );

    patientA = await makePatient(PHONE_A, "Visibility Probe A");
    patientB = await makePatient(PHONE_B, "Visibility Probe B");

    technician = await LabTechnician.findOneAndUpdate(
      { email: TECH_EMAIL },
      {
        $setOnInsert: {
          name: "Visibility Technician",
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
    const phones = [PHONE_A, PHONE_B];
    const appointments = await Appointment.find({
      phone: { $in: phones },
    }).select("_id");
    const ids = appointments.map((a) => a._id);

    await LabResult.deleteMany({ appointmentId: { $in: ids } });
    await LabOrder.deleteMany({ appointmentId: { $in: ids } });
    await Appointment.deleteMany({ phone: { $in: phones } });
    await Patient.deleteMany({ phone: { $in: phones } });
    await LabTechnician.deleteOne({ email: TECH_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("the ordering doctor sees the reported values, units and ranges", async () => {
    const { appointment, order } = await reportedResult({ patient: patientA });

    const res = await req(`/doctor/appointments/${appointment._id}/records`, {
      token: docToken(doctor),
    });

    assert.equal(res.status, 200);

    // The order says where the test got to...
    const seenOrder = res.body.current.labOrders.find(
      (o) => o._id === String(order._id)
    );
    assert.ok(seenOrder);
    assert.equal(seenOrder.status, "Completed");

    // ...and the result carries what was actually measured.
    const seenResult = res.body.current.labResults.find(
      (r) => String(r.labOrderId) === String(order._id)
    );
    assert.ok(seenResult, "the doctor must see the result of a test they ordered");
    assert.equal(seenResult.status, "Completed");
    assert.equal(seenResult.testName, "Thyroid Profile");

    const tsh = seenResult.values.find((v) => v.parameter === "TSH");
    assert.equal(tsh.value, "2.1");
    assert.equal(tsh.unit, "µIU/mL");
    assert.equal(tsh.referenceRange, "0.4 - 4.0");
    assert.equal(tsh.flag, "High");
    assert.equal(seenResult.summary, "Slightly raised TSH");
  });

  test("another doctor cannot reach it", async () => {
    const { appointment } = await reportedResult({ patient: patientA });

    const res = await req(`/doctor/appointments/${appointment._id}/records`, {
      token: docToken(otherDoctor),
    });

    assert.equal(res.status, 403);
  });

  test("the ordering doctor cannot rewrite what the laboratory reported", async () => {
    const { result } = await reportedResult({ patient: patientA });

    const rewrite = await req(`/doctor/lab-results/${result._id}`, {
      method: "PATCH",
      token: docToken(doctor),
      body: {
        values: [
          { parameter: "TSH", value: "0.1", unit: "made up", referenceRange: "x" },
        ],
        summary: "rewritten",
      },
    });

    assert.equal(
      rewrite.status,
      403,
      "a lab-reported result is the laboratory's record"
    );

    const stored = await LabResult.findById(result._id);
    assert.equal(stored.values.find((v) => v.parameter === "TSH").value, "2.1");
    assert.equal(stored.summary, "Slightly raised TSH");

    // A status change is refused the same way - re-opening it would be a
    // rewrite by another route.
    const reopen = await req(`/doctor/lab-results/${result._id}`, {
      method: "PATCH",
      token: docToken(doctor),
      body: { status: "In Progress" },
    });
    assert.equal(reopen.status, 403);
    assert.equal((await LabResult.findById(result._id)).status, "Completed");
  });

  test("a legacy free-text result stays editable by its doctor", async () => {
    // The same endpoint must keep working for the pre-catalog results it was
    // built for - nothing else can reach those.
    const appointment = await Appointment.create({
      patient: patientA._id,
      patientName: patientA.name,
      phone: PHONE_A,
      age: 47,
      gender: "Male",
      doctorId: doctor._id,
      appointmentDate: normalizeToIstDay(new Date()),
      slot: `vis-legacy-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symptoms: "automated test",
      status: "Waiting",
    });

    const legacy = await LabResult.create({
      appointmentId: appointment._id,
      patientId: patientA._id,
      doctorId: doctor._id,
      testName: "Legacy Panel",
      status: "Ordered",
    });

    const res = await req(`/doctor/lab-results/${legacy._id}`, {
      method: "PATCH",
      token: docToken(doctor),
      body: {
        status: "Completed",
        values: [{ parameter: "Haemoglobin", value: "11.2", unit: "g/dL" }],
      },
    });

    assert.equal(res.status, 200);
    assert.equal((await LabResult.findById(legacy._id)).status, "Completed");
  });

  test("a patient sees their own result and nobody else's", async () => {
    await reportedResult({ patient: patientA });

    const mine = await req("/patient/lab-results", { token: patToken(patientA) });
    assert.equal(mine.status, 200);
    assert.ok(mine.body.labResults.length > 0);

    for (const result of mine.body.labResults) {
      assert.equal(String(result.patientId), String(patientA._id));
    }

    const theirs = await req("/patient/lab-results", {
      token: patToken(patientB),
    });
    assert.equal(theirs.status, 200);
    assert.equal(
      theirs.body.labResults.length,
      0,
      "another patient must see none of it"
    );

    const anonymous = await req("/patient/lab-results");
    assert.equal(anonymous.status, 401);
  });

  test("a patient sees no readings until the lab has finalised them", async () => {
    const { order } = await reportedResult({
      patient: patientB,
      complete: false,
    });

    const draft = await req("/patient/lab-results", {
      token: patToken(patientB),
    });

    const seen = draft.body.labResults.find(
      (r) => String(r.labOrderId) === String(order._id)
    );

    assert.ok(seen, "the patient may know a test is under way");
    assert.notEqual(seen.status, "Completed");
    assert.deepEqual(
      seen.values,
      [],
      "a half-entered panel must not be readable as a finished result"
    );
    assert.equal(seen.summary, "");

    // Once the lab finalises it, the readings appear.
    await req(`/lab-technician/lab-orders/${order._id}/result`, {
      method: "PATCH",
      token: techToken(),
      body: {
        values: { TSH: "2.1", T3: "120", T4: "8.0" },
        complete: true,
      },
    });

    const final = await req("/patient/lab-results", {
      token: patToken(patientB),
    });

    const now = final.body.labResults.find(
      (r) => String(r.labOrderId) === String(order._id)
    );
    assert.equal(now.status, "Completed");
    assert.equal(now.values.length, 3);
  });

  test("a patient cannot change a result in any way", async () => {
    const { order, result } = await reportedResult({ patient: patientA });
    const token = patToken(patientA);

    // There is deliberately no patient write endpoint. Every route that could
    // reach a result belongs to another role, so a patient token must be
    // refused by each of them rather than merely absent from the UI.
    const attempts = [
      ["PATCH", `/doctor/lab-results/${result._id}`, { summary: "changed" }],
      [
        "PATCH",
        `/lab-technician/lab-orders/${order._id}/result`,
        { values: { TSH: "9" }, complete: true },
      ],
      ["PATCH", `/lab-technician/lab-orders/${order._id}/start`, {}],
      ["PATCH", `/doctor/lab-orders/${order._id}/cancel`, {}],
      ["DELETE", `/doctor/lab-results/${result._id}`, {}],
    ];

    for (const [method, pathname, body] of attempts) {
      const res = await req(pathname, { method, token, body });
      assert.ok(
        res.status === 401 || res.status === 403 || res.status === 404,
        `${method} ${pathname} should refuse a patient token, got ${res.status}`
      );
    }

    const stored = await LabResult.findById(result._id);
    assert.equal(stored.summary, "Slightly raised TSH");
    assert.equal(stored.status, "Completed");
    assert.equal(stored.values.find((v) => v.parameter === "TSH").value, "2.1");
    assert.equal((await LabOrder.findById(order._id)).status, "Completed");
  });
});
