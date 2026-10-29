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

// Dynamic result entry.
//
// The whole point is that ONE code path serves every test, driven by
// LabTest.parameters. These assert the properties that would be quietly lost
// if someone reintroduced per-test handling or trusted the client:
//
//   - CBC and Thyroid produce different fields from the same endpoint
//   - a client cannot invent a parameter, rename one, or change its unit
//   - the reference range is COPIED onto the result, not resolved later
//   - required parameters gate completion but not a draft
const PORT = 5090;
const BASE = `http://localhost:${PORT}`;
const PHONE = "9990000006";
const TECH_EMAIL = "resultentry.9990000006@example.invalid";

let child;
let doctor;
let patient;
let technician;
let cbc;
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

async function makeOrder(labTest, overrides = {}) {
  const appointment = await Appointment.create({
    patient: patient._id,
    patientName: "Result Entry Probe",
    phone: PHONE,
    age: 39,
    gender: "Female",
    doctorId: doctor._id,
    appointmentDate: normalizeToIstDay(new Date()),
    slot: `result-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symptoms: "automated test",
    status: "Waiting",
    checkedInAt: new Date(),
  });

  const order = await LabOrder.create({
    appointmentId: appointment._id,
    patientId: patient._id,
    doctorId: doctor._id,
    labTestId: labTest._id,
    status: "In Progress",
    startedAt: new Date(),
    ...overrides,
  });

  return { appointment, order };
}

describe("dynamic lab result entry", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    doctor = await Doctor.findOne();
    assert.ok(doctor, "the database needs a doctor to test with");

    cbc = await LabTest.findOne({ name: "Complete Blood Count" });
    thyroid = await LabTest.findOne({ name: "Thyroid Profile" });
    assert.ok(cbc && thyroid, "the demo catalog must be seeded");

    patient = await Patient.findOneAndUpdate(
      { phone: PHONE },
      {
        $setOnInsert: {
          name: "Result Entry Probe",
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
          name: "Result Entry Technician",
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
    const ids = appointments.map((a) => a._id);

    await LabResult.deleteMany({ appointmentId: { $in: ids } });
    await LabOrder.deleteMany({ appointmentId: { $in: ids } });
    await Appointment.deleteMany({ phone: PHONE });
    await Patient.deleteOne({ phone: PHONE });
    await LabTechnician.deleteOne({ email: TECH_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("the SAME endpoint generates CBC fields and Thyroid fields", async () => {
    const cbcOrder = await makeOrder(cbc);
    const thyroidOrder = await makeOrder(thyroid);

    const cbcForm = await req(
      `/lab-technician/lab-orders/${cbcOrder.order._id}/result`,
      { token: techToken() }
    );
    const thyroidForm = await req(
      `/lab-technician/lab-orders/${thyroidOrder.order._id}/result`,
      { token: techToken() }
    );

    assert.equal(cbcForm.status, 200);
    assert.equal(thyroidForm.status, 200);

    const cbcFields = cbcForm.body.labTest.parameters.map((p) => p.name);
    const thyroidFields = thyroidForm.body.labTest.parameters.map((p) => p.name);

    // Different fields, one code path, no per-test branch anywhere.
    assert.ok(cbcFields.includes("Haemoglobin"));
    assert.ok(cbcFields.includes("Platelets"));
    assert.deepEqual(thyroidFields, ["TSH", "T3", "T4"]);
    assert.ok(!thyroidFields.includes("Haemoglobin"));

    // The form carries what a field needs to render itself.
    const hb = cbcForm.body.labTest.parameters.find(
      (p) => p.name === "Haemoglobin"
    );
    assert.equal(hb.unit, "g/dL");
    assert.equal(hb.dataType, "number");
    assert.ok(hb.referenceRange);

    // No draft yet.
    assert.equal(cbcForm.body.labResult, null);
  });

  test("values are rebuilt against the definition, not trusted", async () => {
    const { order } = await makeOrder(thyroid);

    const res = await req(`/lab-technician/lab-orders/${order._id}/result`, {
      method: "PATCH",
      token: techToken(),
      body: {
        values: {
          TSH: "2.1",
          T3: "120",
          T4: "8.0",
          // Not on the Thyroid panel. If the server ever stored what it was
          // sent, this is the parameter that would appear on the report.
          Haemoglobin: "11.2",
          "'; DROP TABLE": "x",
        },
        flags: { TSH: "High", T3: "NotAFlag" },
        complete: true,
      },
    });

    assert.equal(res.status, 200);

    const stored = await LabResult.findOne({ labOrderId: order._id });
    assert.deepEqual(
      stored.values.map((v) => v.parameter),
      ["TSH", "T3", "T4"],
      "only parameters the definition declares may be stored"
    );

    const tsh = stored.values.find((v) => v.parameter === "TSH");
    assert.equal(tsh.value, "2.1");
    // Unit and range come from the catalog, never from the client.
    assert.equal(tsh.unit, "µIU/mL");
    assert.equal(tsh.referenceRange, "0.4 - 4.0");
    assert.equal(tsh.flag, "High");

    // An unrecognised flag falls back rather than being stored.
    assert.equal(stored.values.find((v) => v.parameter === "T3").flag, "Normal");
  });

  test("the reference range is copied onto the result, not resolved later", async () => {
    const { order } = await makeOrder(thyroid);

    await req(`/lab-technician/lab-orders/${order._id}/result`, {
      method: "PATCH",
      token: techToken(),
      body: {
        values: { TSH: "2.1", T3: "120", T4: "8.0" },
        complete: true,
      },
    });

    const before = await LabResult.findOne({ labOrderId: order._id });
    assert.equal(before.values[0].referenceRange, "0.4 - 4.0");

    // The lab revises its range. A report already issued must keep the range
    // it was actually read against - otherwise an old normal result can
    // silently become abnormal.
    const originalRange = thyroid.parameters[0].referenceRange;
    thyroid.parameters[0].referenceRange = "0.5 - 5.0";
    await thyroid.save();

    try {
      const after = await LabResult.findOne({ labOrderId: order._id });
      assert.equal(
        after.values[0].referenceRange,
        "0.4 - 4.0",
        "a reported result must not follow a later catalog revision"
      );
    } finally {
      thyroid.parameters[0].referenceRange = originalRange;
      await thyroid.save();
    }
  });

  test("required parameters gate completion but not a draft", async () => {
    const { order } = await makeOrder(thyroid);

    // A draft may be as incomplete as the bench actually is.
    const draft = await req(`/lab-technician/lab-orders/${order._id}/result`, {
      method: "PATCH",
      token: techToken(),
      body: { values: { TSH: "2.1" }, complete: false },
    });

    assert.equal(draft.status, 200);

    let stored = await LabResult.findOne({ labOrderId: order._id });
    assert.equal(stored.status, "In Progress");
    assert.equal(stored.values.length, 1);
    assert.equal((await LabOrder.findById(order._id)).status, "In Progress");

    // Completing it is not.
    const tooEarly = await req(
      `/lab-technician/lab-orders/${order._id}/result`,
      {
        method: "PATCH",
        token: techToken(),
        body: { values: { TSH: "2.1" }, complete: true },
      }
    );

    assert.equal(tooEarly.status, 400);
    assert.match(tooEarly.body.message, /T3/);
    assert.match(tooEarly.body.message, /T4/);

    // The refused completion left the draft exactly as it was.
    stored = await LabResult.findOne({ labOrderId: order._id });
    assert.equal(stored.status, "In Progress");

    // Resuming the draft returns what was typed.
    const reopened = await req(
      `/lab-technician/lab-orders/${order._id}/result`,
      { token: techToken() }
    );
    assert.equal(reopened.body.labResult.values[0].value, "2.1");

    const done = await req(`/lab-technician/lab-orders/${order._id}/result`, {
      method: "PATCH",
      token: techToken(),
      body: {
        values: { TSH: "2.1", T3: "120", T4: "8.0" },
        summary: "Within range",
        complete: true,
      },
    });

    assert.equal(done.status, 200);

    stored = await LabResult.findOne({ labOrderId: order._id });
    assert.equal(stored.status, "Completed");
    assert.equal(stored.values.length, 3);
    assert.equal(stored.summary, "Within range");
    assert.ok(stored.resultedAt, "completion must stamp when it was reported");

    // The order and its result must never disagree about where the test got to.
    assert.equal((await LabOrder.findById(order._id)).status, "Completed");

    // One result per order, whatever the form does.
    assert.equal(await LabResult.countDocuments({ labOrderId: order._id }), 1);
  });

  test("a REPORTED result cannot be silently rewritten", async () => {
    const { order } = await makeOrder(thyroid);

    await req(`/lab-technician/lab-orders/${order._id}/result`, {
      method: "PATCH",
      token: techToken(),
      body: {
        values: { TSH: "2.1", T3: "120", T4: "8.0" },
        complete: true,
      },
    });

    const reported = await LabResult.findOne({ labOrderId: order._id });
    assert.equal(reported.status, "Completed");

    // Without this rule the endpoint overwrote a reported result in place: a
    // value the doctor had already read and acted on could change to anything,
    // with nothing in the record showing it had. The form already claimed it
    // could no longer be edited, which made that claim decorative.
    const rewrite = await req(
      `/lab-technician/lab-orders/${order._id}/result`,
      {
        method: "PATCH",
        token: techToken(),
        body: {
          values: { TSH: "99", T3: "120", T4: "8.0" },
          complete: true,
        },
      }
    );

    assert.equal(rewrite.status, 400);
    assert.match(rewrite.body.message, /reported/i);

    // Nor by saving a draft over it.
    const asDraft = await req(
      `/lab-technician/lab-orders/${order._id}/result`,
      {
        method: "PATCH",
        token: techToken(),
        body: { values: { TSH: "99" }, complete: false },
      }
    );
    assert.equal(asDraft.status, 400);

    const after = await LabResult.findOne({ labOrderId: order._id });
    assert.equal(
      after.values.find((v) => v.parameter === "TSH").value,
      "2.1",
      "the reported value must be untouched"
    );
    assert.equal(after.status, "Completed");
    assert.equal(
      after.resultedAt.getTime(),
      reported.resultedAt.getTime(),
      "and the reporting time must not move"
    );
  });

  test("a non-numeric reading on a numeric parameter is refused", async () => {
    const { order } = await makeOrder(thyroid);

    const res = await req(`/lab-technician/lab-orders/${order._id}/result`, {
      method: "PATCH",
      token: techToken(),
      body: {
        values: { TSH: "about two", T3: "120", T4: "8.0" },
        complete: true,
      },
    });

    assert.equal(res.status, 400);
    assert.match(res.body.message, /TSH/);
    assert.equal(await LabResult.countDocuments({ labOrderId: order._id }), 0);
  });

  test("the result carries the ORDERING doctor, never the technician", async () => {
    const { order } = await makeOrder(thyroid);

    await req(`/lab-technician/lab-orders/${order._id}/result`, {
      method: "PATCH",
      token: techToken(),
      body: {
        values: { TSH: "2.1", T3: "120", T4: "8.0" },
        // Hostile: if the controller ever trusts the body, the result lands
        // on the wrong chart.
        patientId: String(technician._id),
        doctorId: String(technician._id),
        testName: "Something Else",
        complete: true,
      },
    });

    const stored = await LabResult.findOne({ labOrderId: order._id });
    assert.equal(String(stored.doctorId), String(doctor._id));
    assert.equal(String(stored.patientId), String(patient._id));
    assert.equal(stored.testName, "Thyroid Profile");
    assert.equal(String(stored.labTestId), String(thyroid._id));
  });

  test("withdrawn orders and other roles are refused", async () => {
    const withdrawn = await makeOrder(thyroid, { status: "Cancelled" });

    const onWithdrawn = await req(
      `/lab-technician/lab-orders/${withdrawn.order._id}/result`,
      { method: "PATCH", token: techToken(), body: { values: { TSH: "1" } } }
    );
    assert.equal(onWithdrawn.status, 400);

    const { order } = await makeOrder(thyroid);

    const asDoctor = await req(
      `/lab-technician/lab-orders/${order._id}/result`,
      { method: "PATCH", token: doctorToken(), body: { values: { TSH: "1" } } }
    );
    assert.equal(asDoctor.status, 403);

    const anonymous = await req(
      `/lab-technician/lab-orders/${order._id}/result`
    );
    assert.equal(anonymous.status, 401);

    assert.equal(await LabResult.countDocuments({ labOrderId: order._id }), 0);
  });
});
