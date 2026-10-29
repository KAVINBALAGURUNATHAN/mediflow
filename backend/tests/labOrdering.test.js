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
const { normalizeToIstDay } = require("../utils/istDay");

// Doctor lab ordering against the catalog.
//
// The point of these is that an order is a LINK, not a typed string. The
// failures that would silently undo that:
//
//   - the order stores a name instead of a labTestId
//   - patientId/doctorId are taken from the request body rather than the
//     appointment, so an order can be filed against someone else's chart
//   - a double-clicked button puts the same test on the worklist twice
//   - another doctor can order against a colleague's appointment
//
// Runs a real server against the real database, on its own port, and removes
// everything it creates.
const PORT = 5095;
const BASE = `http://localhost:${PORT}`;
const PHONE = "9990000004";
const TEST_PREFIX = "ZZ Order Panel";

let child;
let doctor;
let otherDoctor;
let patient;
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

const tokenFor = (d) =>
  jwt.sign({ doctorId: String(d._id), role: "doctor" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

async function makeAppointment(overrides = {}) {
  return Appointment.create({
    patient: patient._id,
    patientName: "Lab Order Probe",
    phone: PHONE,
    age: 44,
    gender: "Female",
    doctorId: doctor._id,
    appointmentDate: normalizeToIstDay(new Date()),
    slot: `order-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symptoms: "automated test",
    status: "Waiting",
    checkedInAt: new Date(),
    ...overrides,
  });
}

describe("doctor lab ordering", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    const doctors = await Doctor.find().limit(2);
    doctor = doctors[0];
    otherDoctor = doctors[1];

    assert.ok(doctor, "the database needs a doctor to test with");
    assert.ok(
      otherDoctor,
      "the database needs a SECOND doctor - the cross-doctor check is the point"
    );

    patient = await Patient.findOneAndUpdate(
      { phone: PHONE },
      {
        $setOnInsert: {
          name: "Lab Order Probe",
          phone: PHONE,
          email: `probe.${PHONE}@example.invalid`,
          password: await bcrypt.hash("probe-password-not-real", 4),
        },
      },
      { upsert: true, new: true }
    );

    catalogTest = await LabTest.findOne({ name: "Complete Blood Count" });
    assert.ok(
      catalogTest,
      "the demo catalog must be seeded - run scripts/seedLabTests.js"
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
    await Appointment.deleteMany({ phone: PHONE });
    await Patient.deleteOne({ phone: PHONE });
    await LabTest.deleteMany({ name: new RegExp(`^${TEST_PREFIX}`) });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("a doctor can read the orderable catalog, active tests only", async () => {
    const res = await req("/doctor/lab-tests", { token: tokenFor(doctor) });

    assert.equal(res.status, 200);

    const names = res.body.labTests.map((t) => t.name);
    assert.ok(names.includes("Complete Blood Count"));
    assert.ok(names.includes("Thyroid Profile"));

    // The doctor needs the parameters to show what a panel covers, but gets
    // no write verbs - the catalog is admin-owned.
    const cbc = res.body.labTests.find((t) => t.name === "Complete Blood Count");
    assert.ok(cbc.parameters.length > 0, "parameters come from the definition");

    // A retired test must never be orderable.
    const retired = await LabTest.create({
      name: `${TEST_PREFIX} Retired`,
      parameters: [{ name: "X" }],
      isActive: false,
    });

    const after = await req("/doctor/lab-tests", { token: tokenFor(doctor) });
    assert.ok(
      !after.body.labTests.some((t) => t._id === String(retired._id)),
      "a retired test must not appear in the orderable catalog"
    );
  });

  test("ordering a test links the right patient, doctor and appointment", async () => {
    const appointment = await makeAppointment();

    const res = await req(`/doctor/appointments/${appointment._id}/lab-orders`, {
      method: "POST",
      token: tokenFor(doctor),
      body: {
        labTestId: String(catalogTest._id),
        note: "fasting sample",
        // Deliberately hostile: if the controller ever trusts the body over
        // the appointment, this is the order that lands on the wrong chart.
        patientId: String(otherDoctor._id),
        doctorId: String(otherDoctor._id),
      },
    });

    assert.equal(res.status, 201);

    // Read back from the database, not the response.
    const stored = await LabOrder.findOne({ appointmentId: appointment._id });
    assert.ok(stored, "the order should persist");
    assert.equal(String(stored.appointmentId), String(appointment._id));
    assert.equal(
      String(stored.patientId),
      String(patient._id),
      "patientId must come from the appointment, never the request body"
    );
    assert.equal(
      String(stored.doctorId),
      String(doctor._id),
      "doctorId must come from the appointment, never the request body"
    );
    assert.equal(String(stored.labTestId), String(catalogTest._id));
    assert.equal(stored.status, "Ordered");
    assert.equal(stored.note, "fasting sample");

    // The order points at the definition; it does not copy its parameters.
    assert.equal(
      stored.get("parameters"),
      undefined,
      "parameters belong to the LabTest, not the order"
    );
    assert.equal(
      stored.get("testName"),
      undefined,
      "an order stores a link, not a typed test name"
    );
  });

  test("the same test cannot be ordered twice for one visit", async () => {
    const appointment = await makeAppointment();
    const token = tokenFor(doctor);
    const body = { labTestId: String(catalogTest._id) };

    const first = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      { method: "POST", token, body }
    );
    assert.equal(first.status, 201);

    const second = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      { method: "POST", token, body }
    );
    assert.equal(second.status, 409);

    assert.equal(
      await LabOrder.countDocuments({
        appointmentId: appointment._id,
        labTestId: catalogTest._id,
      }),
      1
    );
  });

  test("withdrawing an order frees the test to be ordered again", async () => {
    const appointment = await makeAppointment();
    const token = tokenFor(doctor);
    const body = { labTestId: String(catalogTest._id) };

    const first = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      { method: "POST", token, body }
    );
    const orderId = first.body.labOrder._id;

    const cancelled = await req(`/doctor/lab-orders/${orderId}/cancel`, {
      method: "PATCH",
      token,
    });
    assert.equal(cancelled.status, 200);

    // Withdrawn, not deleted - that the test was ordered and then withdrawn
    // is part of the visit record.
    const stored = await LabOrder.findById(orderId);
    assert.ok(stored, "a withdrawn order must not be deleted");
    assert.equal(stored.status, "Cancelled");

    // The partial unique index covers only the active statuses, so the same
    // test can now be ordered again.
    const again = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      { method: "POST", token, body }
    );
    assert.equal(again.status, 201);
  });

  test("invalid orders are refused", async () => {
    const appointment = await makeAppointment();
    const token = tokenFor(doctor);

    const noTest = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      { method: "POST", token, body: {} }
    );
    assert.equal(noTest.status, 400);

    const garbageTest = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      { method: "POST", token, body: { labTestId: "not-an-id" } }
    );
    assert.equal(garbageTest.status, 400);

    const missingTest = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      {
        method: "POST",
        token,
        body: { labTestId: new mongoose.Types.ObjectId().toString() },
      }
    );
    assert.equal(missingTest.status, 404);

    const retired = await LabTest.create({
      name: `${TEST_PREFIX} Withdrawn`,
      parameters: [{ name: "X" }],
      isActive: false,
    });

    const retiredOrder = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      { method: "POST", token, body: { labTestId: String(retired._id) } }
    );
    assert.equal(retiredOrder.status, 400);

    const badAppointment = await req(
      `/doctor/appointments/not-an-id/lab-orders`,
      { method: "POST", token, body: { labTestId: String(catalogTest._id) } }
    );
    assert.equal(badAppointment.status, 400);

    assert.equal(
      await LabOrder.countDocuments({ appointmentId: appointment._id }),
      0,
      "no refused request may leave an order behind"
    );
  });

  test("a test cannot be ordered on a closed visit", async () => {
    const cancelled = await makeAppointment({ status: "Cancelled" });

    const onCancelled = await req(
      `/doctor/appointments/${cancelled._id}/lab-orders`,
      {
        method: "POST",
        token: tokenFor(doctor),
        body: { labTestId: String(catalogTest._id) },
      }
    );
    assert.equal(onCancelled.status, 400);

    // A completed consultation is closed everywhere else in this codebase -
    // vitals refuse it too. An order added afterwards would land on the
    // technician's worklist for a visit that already ended.
    const completed = await makeAppointment({
      status: "Completed",
      diagnosis: "automated test",
      prescription: "automated test",
      consultationStartedAt: new Date(),
    });

    const onCompleted = await req(
      `/doctor/appointments/${completed._id}/lab-orders`,
      {
        method: "POST",
        token: tokenFor(doctor),
        body: { labTestId: String(catalogTest._id) },
      }
    );
    assert.equal(onCompleted.status, 400);

    assert.equal(
      await LabOrder.countDocuments({
        appointmentId: { $in: [cancelled._id, completed._id] },
      }),
      0,
      "a refused order must leave nothing behind"
    );
  });

  test("another doctor cannot order against, read or withdraw this visit", async () => {
    const appointment = await makeAppointment();

    const ordered = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      {
        method: "POST",
        token: tokenFor(doctor),
        body: { labTestId: String(catalogTest._id) },
      }
    );
    const orderId = ordered.body.labOrder._id;

    const foreignOrder = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      {
        method: "POST",
        token: tokenFor(otherDoctor),
        body: { labTestId: String(catalogTest._id) },
      }
    );
    assert.equal(foreignOrder.status, 403);

    const foreignRead = await req(
      `/doctor/appointments/${appointment._id}/lab-orders`,
      { token: tokenFor(otherDoctor) }
    );
    assert.equal(foreignRead.status, 403);

    // Checked against the order's own doctor, so a guessed id gets nowhere.
    const foreignCancel = await req(`/doctor/lab-orders/${orderId}/cancel`, {
      method: "PATCH",
      token: tokenFor(otherDoctor),
    });
    assert.equal(foreignCancel.status, 403);

    const anonymous = await req("/doctor/lab-tests");
    assert.equal(anonymous.status, 401);

    const stored = await LabOrder.findById(orderId);
    assert.equal(stored.status, "Ordered", "nothing refused may have changed it");
  });

  test("orders appear on the consultation records bundle", async () => {
    const appointment = await makeAppointment();
    const token = tokenFor(doctor);

    await req(`/doctor/appointments/${appointment._id}/lab-orders`, {
      method: "POST",
      token,
      body: { labTestId: String(catalogTest._id) },
    });

    // The consultation screen loads this one bundle, so an order that is not
    // in it is invisible to the doctor who just placed it.
    const records = await req(
      `/doctor/appointments/${appointment._id}/records`,
      { token }
    );

    assert.equal(records.status, 200);
    assert.equal(records.body.current.labOrders.length, 1);

    const order = records.body.current.labOrders[0];
    assert.equal(order.labTestId.name, "Complete Blood Count");
    assert.ok(
      order.labTestId.parameters.some((p) => p.name === "Haemoglobin"),
      "the definition's parameters ride along, so the doctor sees what is measured"
    );

    // The legacy free-text list is still returned and still separate.
    assert.ok(Array.isArray(records.body.current.labResults));
  });
});
