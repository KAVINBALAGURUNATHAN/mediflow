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
const Receptionist = require("../models/Receptionist");
const Nurse = require("../models/Nurse");
const LabTechnician = require("../models/LabTechnician");
const Appointment = require("../models/Appointment");
const LabTest = require("../models/LabTest");
const LabOrder = require("../models/LabOrder");
const LabResult = require("../models/LabResult");
const Prescription = require("../models/Prescription");
const { getDoctorDaySlots } = require("../utils/doctorAvailability");
const { normalizeToIstDay } = require("../utils/istDay");

// ONE visit, driven through the real HTTP endpoints in the real order, by the
// real roles:
//
//   patient books -> reception checks in -> nurse records vitals and hands
//   over -> doctor consults and orders a lab test -> technician runs and
//   reports it -> doctor reads the result and completes the visit ->
//   patient sees their own result
//
// The per-phase suites each prove their own step in isolation. This one exists
// because the failures that survive that are the ones BETWEEN steps: a nurse
// hand-off the doctor cannot see, an order whose result never reaches the
// chart, a completion rule that blocks the last click. It shares no fixtures
// with the other suites - it books a genuinely free slot the same way the
// booking page does.
const PORT = 5083;
const BASE = `http://localhost:${PORT}`;
const PHONE = "9990000010";
const NURSE_EMAIL = "e2e.nurse.9990000010@example.invalid";
const TECH_EMAIL = "e2e.tech.9990000010@example.invalid";

let child;
let doctor;
let receptionist;
let nurse;
let technician;
let patient;
let cbc;

// Filled in as the visit progresses, so each step reads what the previous
// one actually produced rather than a fixture.
const visit = {};

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

const sign = (claims) =>
  jwt.sign(claims, process.env.JWT_SECRET, { expiresIn: "1h" });

const asDoctor = () => sign({ doctorId: String(doctor._id), role: "doctor" });
const asReceptionist = () =>
  sign({ receptionistId: String(receptionist._id), role: "receptionist" });
const asNurse = () => sign({ nurseId: String(nurse._id), role: "nurse" });
const asTechnician = () =>
  sign({ labTechnicianId: String(technician._id), role: "labTechnician" });
const asPatient = () =>
  sign({ patientId: String(patient._id), phone: PHONE, role: "patient" });

describe("end-to-end visit: booking through to lab result", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    doctor = await Doctor.findOne({ isAvailable: true });
    receptionist = await Receptionist.findOne();
    cbc = await LabTest.findOne({ name: "Complete Blood Count" });

    assert.ok(doctor, "needs an available doctor");
    assert.ok(receptionist, "needs a receptionist");
    assert.ok(cbc, "the demo catalog must be seeded - scripts/seedLabTests.js");

    patient = await Patient.findOneAndUpdate(
      { phone: PHONE },
      {
        $setOnInsert: {
          name: "End To End Probe",
          phone: PHONE,
          email: `probe.${PHONE}@example.invalid`,
          password: await bcrypt.hash("probe-password-not-real", 4),
        },
      },
      { upsert: true, new: true }
    );

    // This suite creates its own nurse and technician rather than using the
    // real staff accounts, so a run can never alter live credentials.
    nurse = await Nurse.findOneAndUpdate(
      { email: NURSE_EMAIL },
      {
        $setOnInsert: {
          name: "E2E Nurse",
          email: NURSE_EMAIL,
          password: "not-a-usable-login",
        },
      },
      { upsert: true, new: true }
    );

    technician = await LabTechnician.findOneAndUpdate(
      { email: TECH_EMAIL },
      {
        $setOnInsert: {
          name: "E2E Technician",
          email: TECH_EMAIL,
          password: "not-a-usable-login",
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
    await Prescription.deleteMany({ appointmentId: { $in: ids } });
    await Appointment.deleteMany({ phone: PHONE });
    await Patient.deleteOne({ phone: PHONE });
    await Nurse.deleteOne({ email: NURSE_EMAIL });
    await LabTechnician.deleteOne({ email: TECH_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("1. the patient books a real free slot and gets a token", async () => {
    const { slots } = await getDoctorDaySlots(doctor, new Date());

    if (!slots.length) {
      // Not a failure: the doctor is genuinely fully booked today. Say so
      // rather than passing silently or inventing a slot that collides.
      visit.skipped = "the doctor has no free slot left today";
      return;
    }

    // The last free slot, so this run competes as little as possible with the
    // real bookings already in the database.
    const slot = slots[slots.length - 1];

    const istToday = new Date(
      normalizeToIstDay(new Date()).getTime() + 5.5 * 60 * 60 * 1000
    )
      .toISOString()
      .slice(0, 10);

    const booked = await req("/appointments", {
      method: "POST",
      body: {
        doctorId: String(doctor._id),
        patientName: "End To End Probe",
        age: 45,
        phone: PHONE,
        symptoms: "automated end-to-end test",
        appointmentDate: istToday,
        slot,
      },
    });

    assert.equal(booked.status, 201, JSON.stringify(booked.body));

    const stored = await Appointment.findOne({ phone: PHONE }).sort({
      createdAt: -1,
    });

    assert.ok(stored, "the booking should persist");
    assert.equal(stored.status, "Waiting");
    assert.ok(stored.bookingId, "a booking id is issued");
    assert.ok(
      stored.tokenNumber,
      "the token is assigned at BOOKING, not at check-in"
    );
    assert.equal(stored.checkedInAt, null, "booking is not arrival");

    visit.appointmentId = String(stored._id);
    visit.slot = slot;
  });

  test("2. reception checks the patient in, and cannot record vitals", async () => {
    if (visit.skipped) return;

    const checkedIn = await req(
      `/receptionist/appointments/${visit.appointmentId}/check-in`,
      {
        method: "PATCH",
        token: asReceptionist(),
        // Sent deliberately: check-in must record arrival and ignore any
        // clinical measurement in the body.
        body: { priority: "Normal", heightCm: 170, weightKg: 72 },
      }
    );

    assert.equal(checkedIn.status, 200);

    let stored = await Appointment.findById(visit.appointmentId);
    assert.ok(stored.checkedInAt, "the patient has arrived");
    assert.equal(stored.status, "Waiting", "arrival is not a status change");
    assert.equal(
      stored.vitals.heightCm,
      null,
      "reception must not write a clinical measurement"
    );

    // And the endpoint that used to let them is gone.
    const vitals = await req(
      `/receptionist/appointments/${visit.appointmentId}/vitals`,
      {
        method: "PATCH",
        token: asReceptionist(),
        body: { heightCm: 170, weightKg: 72 },
      }
    );
    assert.notEqual(vitals.status, 200);
  });

  test("3. the nurse records vitals and hands the patient over", async () => {
    if (visit.skipped) return;

    const queue = await req("/nurse/queue", { token: asNurse() });
    assert.equal(queue.status, 200);
    assert.ok(
      queue.body.awaitingVitals.some((a) => a._id === visit.appointmentId),
      "a checked-in patient is the nurse's work"
    );

    const recorded = await req(
      `/nurse/appointments/${visit.appointmentId}/vitals`,
      {
        method: "PATCH",
        token: asNurse(),
        body: {
          heightCm: 170,
          weightKg: 72,
          bloodPressureSystolic: 128,
          bloodPressureDiastolic: 84,
          temperatureC: 37.1,
          pulseBpm: 78,
          spo2: 97,
        },
      }
    );
    assert.equal(recorded.status, 200);

    const ready = await req(
      `/nurse/appointments/${visit.appointmentId}/ready`,
      { method: "PATCH", token: asNurse() }
    );
    assert.equal(ready.status, 200);

    const stored = await Appointment.findById(visit.appointmentId);
    assert.equal(stored.vitals.bmi, 24.9, "BMI is derived, not typed");
    assert.equal(stored.vitals.spo2, 97);
    assert.ok(stored.readyForDoctorAt, "the hand-off is stamped");

    // The nurse's list has moved them across.
    const after = await req("/nurse/queue", { token: asNurse() });
    assert.ok(
      after.body.readyForDoctor.some((a) => a._id === visit.appointmentId)
    );
  });

  test("4. the patient reaches the doctor's queue and the consultation starts", async () => {
    if (visit.skipped) return;

    const queue = await req("/doctor/live-queue", { token: asDoctor() });
    assert.equal(queue.status, 200);
    assert.ok(
      queue.body.some((row) => row._id === visit.appointmentId),
      "a checked-in patient with a token is in the doctor's queue"
    );

    const started = await req(
      `/doctor/appointments/${visit.appointmentId}/start-consultation`,
      { method: "PATCH", token: asDoctor() }
    );
    assert.equal(started.status, 200);

    const stored = await Appointment.findById(visit.appointmentId);
    assert.equal(stored.status, "In Consultation");
    assert.ok(stored.consultationStartedAt);

    // The doctor can read what the nurse measured - the whole point of the
    // hand-off.
    const seen = await req(`/appointments/${visit.appointmentId}`, {
      token: asDoctor(),
    });
    const appointment = seen.body.appointment || seen.body;
    assert.equal(appointment.vitals.bmi, 24.9);
    assert.equal(appointment.vitals.bloodPressureSystolic, 128);
    assert.ok(appointment.readyForDoctorAt);
  });

  test("5. the doctor orders a lab test from the catalog", async () => {
    if (visit.skipped) return;

    const catalog = await req("/doctor/lab-tests", { token: asDoctor() });
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.labTests.some((t) => t.name === "Complete Blood Count"));

    const ordered = await req(
      `/doctor/appointments/${visit.appointmentId}/lab-orders`,
      {
        method: "POST",
        token: asDoctor(),
        body: { labTestId: String(cbc._id), note: "fasting sample" },
      }
    );
    assert.equal(ordered.status, 201);

    const stored = await LabOrder.findOne({
      appointmentId: visit.appointmentId,
    });
    assert.ok(stored);
    assert.equal(stored.status, "Ordered");
    assert.equal(
      String(stored.patientId),
      String(patient._id),
      "the order is attached to the right patient"
    );
    assert.equal(String(stored.doctorId), String(doctor._id));

    visit.labOrderId = String(stored._id);
  });

  test("6. the laboratory picks the order up and reports it", async () => {
    if (visit.skipped) return;

    const worklist = await req("/lab-technician/worklist", {
      token: asTechnician(),
    });
    assert.equal(worklist.status, 200);

    const mine = worklist.body.pending.find((o) => o._id === visit.labOrderId);
    assert.ok(mine, "the doctor's order reaches the lab");
    assert.equal(mine.patientId.name, "End To End Probe");
    assert.equal(mine.labTestId.name, "Complete Blood Count");
    assert.equal(mine.doctorId.name, doctor.name);

    const started = await req(
      `/lab-technician/lab-orders/${visit.labOrderId}/start`,
      { method: "PATCH", token: asTechnician() }
    );
    assert.equal(started.status, 200);

    // The form is generated from the catalog definition, not typed.
    const form = await req(
      `/lab-technician/lab-orders/${visit.labOrderId}/result`,
      { token: asTechnician() }
    );
    assert.equal(form.status, 200);

    const fields = form.body.labTest.parameters.map((p) => p.name);
    assert.ok(fields.includes("Haemoglobin"));
    assert.ok(fields.includes("Platelets"));

    // Report every required parameter, using the field names the form gave us.
    const values = {};
    const readings = {
      Haemoglobin: "11.2",
      "White Blood Cells": "7800",
      Platelets: "250000",
      "Red Blood Cells": "4.8",
      Haematocrit: "42",
    };
    for (const parameter of form.body.labTest.parameters) {
      if (readings[parameter.name]) values[parameter.name] = readings[parameter.name];
    }

    const reported = await req(
      `/lab-technician/lab-orders/${visit.labOrderId}/result`,
      {
        method: "PATCH",
        token: asTechnician(),
        body: {
          values,
          flags: { Haemoglobin: "Low" },
          summary: "Mild anaemia",
          complete: true,
        },
      }
    );
    assert.equal(reported.status, 200, JSON.stringify(reported.body));

    const result = await LabResult.findOne({ labOrderId: visit.labOrderId });
    assert.ok(result);
    assert.equal(result.status, "Completed");
    assert.ok(result.resultedAt);

    const hb = result.values.find((v) => v.parameter === "Haemoglobin");
    assert.equal(hb.value, "11.2");
    // The unit and range came from the catalog, not from anything posted.
    assert.equal(hb.unit, "g/dL");
    assert.equal(hb.referenceRange, "13.0 - 17.0");
    assert.equal(hb.flag, "Low");

    assert.equal(
      (await LabOrder.findById(visit.labOrderId)).status,
      "Completed",
      "the order and its result agree"
    );

    visit.labResultId = String(result._id);
  });

  test("7. the doctor reads the result and completes the visit", async () => {
    if (visit.skipped) return;

    const records = await req(
      `/doctor/appointments/${visit.appointmentId}/records`,
      { token: asDoctor() }
    );
    assert.equal(records.status, 200);

    const order = records.body.current.labOrders.find(
      (o) => o._id === visit.labOrderId
    );
    assert.equal(order.status, "Completed");

    const result = records.body.current.labResults.find(
      (r) => r._id === visit.labResultId
    );
    assert.ok(result, "the doctor sees the result of the test they ordered");
    assert.equal(
      result.values.find((v) => v.parameter === "Haemoglobin").value,
      "11.2"
    );
    assert.equal(result.summary, "Mild anaemia");

    // And cannot rewrite what the lab reported.
    const rewrite = await req(`/doctor/lab-results/${visit.labResultId}`, {
      method: "PATCH",
      token: asDoctor(),
      body: { summary: "rewritten" },
    });
    assert.equal(rewrite.status, 403);

    // Completion needs the medical record, which is what gates the last click.
    const tooEarly = await req(`/appointments/${visit.appointmentId}`, {
      method: "PATCH",
      token: asDoctor(),
      body: { status: "Completed" },
    });
    assert.notEqual(
      tooEarly.status,
      200,
      "a visit cannot complete without a diagnosis and prescription"
    );

    const completed = await req(`/appointments/${visit.appointmentId}`, {
      method: "PATCH",
      token: asDoctor(),
      body: {
        status: "Completed",
        diagnosis: "Iron deficiency anaemia",
        prescription: "Ferrous sulphate 200 mg twice daily for 30 days",
      },
    });
    assert.equal(completed.status, 200, JSON.stringify(completed.body));

    const stored = await Appointment.findById(visit.appointmentId);
    assert.equal(stored.status, "Completed");
    assert.ok(stored.completedAt);
  });

  test("8. the patient sees their own result, and only their own", async () => {
    if (visit.skipped) return;

    const mine = await req("/patient/lab-results", { token: asPatient() });
    assert.equal(mine.status, 200);

    const seen = mine.body.labResults.find((r) => r._id === visit.labResultId);
    assert.ok(seen, "the patient can read their finished result");
    assert.equal(seen.status, "Completed");
    assert.equal(seen.testName, "Complete Blood Count");
    assert.equal(
      seen.values.find((v) => v.parameter === "Haemoglobin").value,
      "11.2"
    );

    // The visit itself is in their portal too.
    const appointments = await req("/patient/appointments", {
      token: asPatient(),
    });
    assert.equal(appointments.status, 200);

    // And they cannot change any of it.
    const edit = await req(`/doctor/lab-results/${visit.labResultId}`, {
      method: "PATCH",
      token: asPatient(),
      body: { summary: "changed" },
    });
    assert.ok(edit.status === 401 || edit.status === 403);

    assert.equal(
      (await LabResult.findById(visit.labResultId)).summary,
      "Mild anaemia"
    );
  });

  test("9. a completed visit is closed to further clinical work", async () => {
    if (visit.skipped) return;

    // NOTE: this application has no receptionist CHECK-OUT. There is no
    // checkedOutAt field, no endpoint and no status for it - "Completed",
    // set by the doctor, is the only thing that closes a visit. These assert
    // what closing actually means today, so that if check-out is built later
    // it has something concrete to preserve.
    const stored = await Appointment.findById(visit.appointmentId);
    assert.equal(stored.status, "Completed");

    // The doctor cannot start it again.
    const restart = await req(
      `/doctor/appointments/${visit.appointmentId}/start-consultation`,
      { method: "PATCH", token: asDoctor() }
    );
    assert.notEqual(restart.status, 200, "a finished visit cannot be reopened");
    assert.equal(
      (await Appointment.findById(visit.appointmentId)).status,
      "Completed"
    );

    // The nurse does not get the patient back.
    const nurseQueue = await req("/nurse/queue", { token: asNurse() });
    const nurseIds = [
      ...nurseQueue.body.awaitingVitals,
      ...nurseQueue.body.readyForDoctor,
    ].map((a) => a._id);
    assert.ok(!nurseIds.includes(visit.appointmentId));

    const lateVitals = await req(
      `/nurse/appointments/${visit.appointmentId}/vitals`,
      { method: "PATCH", token: asNurse(), body: { heightCm: 171, weightKg: 73 } }
    );
    assert.equal(lateVitals.status, 400);

    // No new lab work can be attached to it either.
    const lateOrder = await req(
      `/doctor/appointments/${visit.appointmentId}/lab-orders`,
      { method: "POST", token: asDoctor(), body: { labTestId: String(cbc._id) } }
    );
    assert.equal(lateOrder.status, 400);

    // But the history stays readable - closing a visit is not erasing it.
    const records = await req(
      `/doctor/appointments/${visit.appointmentId}/records`,
      { token: asDoctor() }
    );
    assert.equal(records.status, 200);
    assert.ok(records.body.current.labResults.length > 0);

    const patientView = await req("/patient/lab-results", {
      token: asPatient(),
    });
    assert.ok(
      patientView.body.labResults.some((r) => r._id === visit.labResultId),
      "the patient keeps access to their result after the visit closes"
    );
  });

  test("10. the whole visit is coherent afterwards", async () => {
    if (visit.skipped) {
      // Surfaced as a real result rather than a silent pass.
      console.log(`      SKIPPED: ${visit.skipped}`);
      return;
    }

    const appointment = await Appointment.findById(visit.appointmentId);
    const order = await LabOrder.findById(visit.labOrderId);
    const result = await LabResult.findById(visit.labResultId);

    // Every link in the chain points where it should.
    assert.equal(String(order.appointmentId), String(appointment._id));
    assert.equal(String(order.labTestId), String(cbc._id));
    assert.equal(String(result.labOrderId), String(order._id));
    assert.equal(String(result.labTestId), String(cbc._id));
    assert.equal(String(result.appointmentId), String(appointment._id));
    assert.equal(String(result.patientId), String(patient._id));
    assert.equal(String(result.doctorId), String(doctor._id));

    // And the timeline runs forwards.
    const order_of_events = [
      appointment.checkedInAt,
      appointment.readyForDoctorAt,
      appointment.consultationStartedAt,
      order.orderedAt,
      order.startedAt,
      result.resultedAt,
      appointment.completedAt,
    ];

    for (const stamp of order_of_events) {
      assert.ok(stamp, "every step of the visit is timestamped");
    }

    assert.ok(
      appointment.checkedInAt <= appointment.readyForDoctorAt,
      "vitals are recorded after arrival"
    );
    assert.ok(
      order.orderedAt <= result.resultedAt,
      "a test is reported after it is ordered"
    );
  });
});
