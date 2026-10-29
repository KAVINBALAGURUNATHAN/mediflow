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
const Receptionist = require("../models/Receptionist");
const Appointment = require("../models/Appointment");
const WaitingListEntry = require("../models/WaitingListEntry");
const { normalizeToIstDay } = require("../utils/istDay");
const { getDoctorDaySlots } = require("../utils/doctorAvailability");
const { slotToMinutes } = require("../utils/queueOrder");
const {
  isLate,
  isLateArrival,
  isOverdue,
  minutesLate,
  DEFAULT_GRACE_MINUTES,
} = require("../utils/lateness");

// The queue rules, stated as tests.
//
// The rule everything here defends: A LATE PATIENT KEEPS THEIR PLACE. Arriving
// after your slot time costs you nothing - not the appointment, not the slot,
// not your position ahead of people booked later. Nothing is automatic; every
// consequence is a deliberate action by reception.
//
// Own doctor and own slot labels, because these assert exact queue ORDER and
// any other suite's booking on the same day would change it.
const PORT = 5074;
const BASE = `http://localhost:${PORT}`;
const PHONES = ["9990000091", "9990000092", "9990000093"];
const DOCTOR_EMAIL = "queue.edgecase.probe@example.invalid";

let child;
let doctor;
let receptionist;
let patients = [];

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

const asDoctor = () =>
  jwt.sign({ doctorId: String(doctor._id), role: "doctor" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

const asReceptionist = () =>
  jwt.sign(
    { receptionistId: String(receptionist._id), role: "receptionist" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

const today = () => normalizeToIstDay(new Date());

// Arrival, expressed as minutes after the slot, on TODAY's IST day.
//
// These instants used to be written out as fixed UTC times - Date.UTC(2026,
// 7, 24, 3, 33) for "09:03 IST, three minutes late". book() has always put
// the appointment on today, so the moment the calendar left 24 Aug 2026 the
// arrival belonged to a different day from the appointment, and the lateness
// arithmetic (correctly, since it anchors to the appointment's own day)
// reported nonsense. The suite passed on the day it was written and failed
// the next morning.
const arrivedAfter = (slot, minutesAfter) =>
  new Date(
    today().getTime() + (slotToMinutes(slot) + minutesAfter) * 60 * 1000
  );
const minutesAgo = (n) => new Date(Date.now() - n * 60 * 1000);

async function book(patient, slot, tokenNumber, checkedInAt = null, extra = {}) {
  return Appointment.create({
    patient: patient._id,
    patientName: patient.name,
    phone: patient.phone,
    age: 40,
    gender: "Male",
    doctorId: doctor._id,
    appointmentDate: today(),
    slot,
    symptoms: "automated test",
    status: "Waiting",
    tokenNumber,
    checkedInAt,
    ...extra,
  });
}

describe("queue edge cases", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    doctor = await Doctor.findOneAndUpdate(
      { email: DOCTOR_EMAIL },
      {
        $setOnInsert: {
          name: "Queue Edge Case Probe",
          email: DOCTOR_EMAIL,
          password: "not-a-usable-login",
          specialization: "General Medicine",
          location: "Test",
          experience: 1,
          consultationFee: 1,
          workingHours: { start: "00:00", end: "23:40" },
          workingDays: [
            "Sunday",
            "Monday",
            "Tuesday",
            "Wednesday",
            "Thursday",
            "Friday",
            "Saturday",
          ],
          slotDuration: 20,
          isAvailable: true,
        },
      },
      { upsert: true, new: true }
    );

    receptionist = await Receptionist.findOne();
    assert.ok(receptionist, "needs a receptionist");

    patients = [];
    for (let i = 0; i < PHONES.length; i++) {
      patients.push(
        await Patient.findOneAndUpdate(
          { phone: PHONES[i] },
          {
            $setOnInsert: {
              name: `Queue Probe ${String.fromCharCode(65 + i)}`,
              phone: PHONES[i],
              email: `probe.${PHONES[i]}@example.invalid`,
              password: await bcrypt.hash("probe-password-not-real", 4),
            },
          },
          { upsert: true, new: true }
        )
      );
    }

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

  beforeEach(async () => {
    await WaitingListEntry.deleteMany({
      patient: { $in: patients.map((p) => p._id) },
    });
    await Appointment.deleteMany({ doctorId: doctor._id });
  });

  after(async () => {
    await WaitingListEntry.deleteMany({
      patient: { $in: patients.map((p) => p._id) },
    });
    await Appointment.deleteMany({ doctorId: doctor._id });
    await Patient.deleteMany({ phone: { $in: PHONES } });
    await Doctor.deleteOne({ email: DOCTOR_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  // EC24 + the core rule.
  test("a late arrival keeps their place; a later booking does not jump ahead", async () => {
    // A is booked 09:00 and arrived at 09:05. B is booked 09:20 and arrived
    // FIRST, at 09:10. The queue must still call A first.
    await book(patients[0], "09:00 AM", 101, minutesAgo(5));
    await book(patients[1], "09:20 AM", 102, minutesAgo(10));

    const queue = await req("/doctor/live-queue", { token: asDoctor() });

    assert.equal(queue.status, 200);
    assert.deepEqual(
      queue.body.map((row) => row.slot),
      ["09:00 AM", "09:20 AM"],
      "appointment time decides, not who walked in first"
    );

    const next = await req("/doctor/dashboard/next-patient", {
      token: asDoctor(),
    });
    assert.equal(next.body.patient.slot, "09:00 AM");
  });

  // EC1, EC2, EC8 - being late has no automatic consequence at all.
  test("being late changes nothing on the appointment", async () => {
    const late = await book(patients[0], "09:00 AM", 111, minutesAgo(1));

    // A restart is when the expiry routine runs, so this covers it.
    await req("/doctor/live-queue", { token: asDoctor() });

    const stored = await Appointment.findById(late._id);
    assert.equal(stored.status, "Waiting");
    assert.equal(stored.slotActive, true, "still holds the slot");
    assert.equal(stored.noShowAt, null);
    assert.equal(
      await WaitingListEntry.countDocuments({ patient: patients[0]._id }),
      0,
      "and is not moved to the waiting list by anything automatic"
    );
  });

  // EC4 and EC7 - the fix. Arrival, not a token, puts you in the queue.
  test("a patient who has not arrived is NOT in the doctor's queue", async () => {
    await book(patients[0], "09:00 AM", 121, minutesAgo(5));
    // Booked for today, holds a token from booking, but is not here.
    const absent = await book(patients[1], "09:20 AM", 122, null);

    const queue = await req("/doctor/live-queue", { token: asDoctor() });

    assert.ok(
      !queue.body.some((row) => row._id === String(absent._id)),
      "the doctor must not be sent to call someone who has not arrived"
    );
    assert.equal(queue.body.length, 1);

    const next = await req("/doctor/dashboard/next-patient", {
      token: asDoctor(),
    });
    assert.notEqual(
      next.body.patient?._id,
      String(absent._id),
      "and 'next patient' must never be them either"
    );

    // Checking them in is what puts them in the queue - and in the right
    // place, ahead of nobody they were booked after.
    await req(`/receptionist/appointments/${absent._id}/check-in`, {
      method: "PATCH",
      token: asReceptionist(),
      body: { priority: "Normal" },
    });

    const after = await req("/doctor/live-queue", { token: asDoctor() });
    assert.deepEqual(
      after.body.map((row) => row.slot),
      ["09:00 AM", "09:20 AM"]
    );
  });

  // EC7 - the doctor being busy is not a reason to do anything to B.
  test("arriving while the previous patient is still consulting just means waiting", async () => {
    await book(patients[0], "09:00 AM", 131, minutesAgo(30), {
      status: "In Consultation",
      consultationStartedAt: minutesAgo(20),
    });
    const b = await book(patients[1], "09:20 AM", 132, minutesAgo(5));

    const queue = await req("/doctor/live-queue", { token: asDoctor() });

    assert.equal(queue.body.length, 2);
    assert.ok(queue.body.some((row) => row._id === String(b._id)));

    const stored = await Appointment.findById(b._id);
    assert.equal(stored.status, "Waiting", "B simply waits");
    assert.equal(stored.slotActive, true, "no vacancy is created for B");
    assert.equal(
      await WaitingListEntry.countDocuments({ patient: patients[1]._id }),
      0
    );

    // And B is who the doctor gets next.
    const next = await req("/doctor/dashboard/next-patient", {
      token: asDoctor(),
    });
    assert.equal(next.body.patient._id, String(b._id));
  });

  // The 5-minute grace period, at every boundary that matters.
  test("the grace period is 5 minutes, and 5 is still inside it", async () => {
    assert.equal(DEFAULT_GRACE_MINUTES, 5);

    // 09:00 IST is 03:30 UTC. Arrival is measured from checkedInAt, so these
    // are exact rather than clock-dependent.
    const arrivedAt = (offset) => ({
      slot: "09:00 AM",
      status: "Waiting",
      checkedInAt: arrivedAfter("09:00 AM", offset),
    });

    for (const [offset, late] of [
      [0, false], // on time
      [1, false], // 1 minute late
      [5, false], // EXACTLY 5 - still within grace
      [6, true], //  6 - the first minute outside it
      [10, true],
      [45, true],
    ]) {
      const appointment = arrivedAt(offset);
      assert.equal(minutesLate(appointment), offset);
      assert.equal(
        isLate(appointment),
        late,
        `arriving T+${offset} should ${late ? "be" : "not be"} late`
      );
      assert.equal(isLateArrival(appointment), late);
      // Having arrived, they are never "overdue" whatever the delay.
      assert.equal(isOverdue(appointment), false);
    }

    // Arriving EARLY is not late either.
    assert.ok(minutesLate(arrivedAt(-10)) < 0);
    assert.equal(isLate(arrivedAt(-10)), false);

    // A patient who has not arrived is overdue, not late-arriving - the
    // decision there is a no-show, not a move.
    const notHere = {
      slot: "12:01 AM",
      status: "Waiting",
      checkedInAt: null,
    };
    assert.equal(isOverdue(notHere), true);
    assert.equal(isLateArrival(notHere), false);

    // The threshold is configurable and honoured.
    assert.equal(isLate(arrivedAt(6), { graceMinutes: 30 }), false);
  });

  test("lateness does not wrap across midnight, or across days", async () => {
    // A late-evening slot checked just after midnight. Comparing bare
    // wall-clock minutes made this -1410 - "not late" - for a patient half an
    // hour overdue, because the day rolled over. The arithmetic is anchored to
    // the appointment's own day precisely so it cannot wrap.
    const istInstant = (y, mo, d, h, mi) =>
      new Date(Date.UTC(y, mo, d, h, mi) - 5.5 * 60 * 60 * 1000);

    const eveningSlot = {
      slot: "11:40 PM",
      status: "Waiting",
      appointmentDate: istInstant(2026, 7, 24, 0, 0),
      checkedInAt: null,
    };

    const justAfterMidnight = istInstant(2026, 7, 25, 0, 10);

    assert.equal(minutesLate(eveningSlot, justAfterMidnight), 30);
    assert.equal(
      isOverdue(eveningSlot, { now: justAfterMidnight }),
      true,
      "a patient 30 minutes overdue must not read as on time because the date changed"
    );

    // And a checkedInAt from a DIFFERENT day must not be read as though it
    // were today - a stale record reported a nonsense grace decision.
    const staleArrival = {
      slot: "09:00 AM",
      status: "Waiting",
      appointmentDate: istInstant(2026, 7, 24, 0, 0),
      checkedInAt: istInstant(2026, 7, 23, 9, 3),
    };

    assert.ok(
      minutesLate(staleArrival) < -1000,
      "yesterday's arrival must not read as three minutes late"
    );
  });

  test("a patient inside the grace period cannot be moved to the waiting list", async () => {
    // Arrived 3 minutes late - server-side, not just hidden in the UI.
    const inGrace = await book(
      patients[0],
      "09:00 AM",
      171,
      arrivedAfter("09:00 AM", 3)
    );

    const refused = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { appointmentId: String(inGrace._id) },
    });

    assert.equal(refused.status, 400);
    assert.match(refused.body.message, /grace period/i);

    // Their slot and queue position are untouched.
    const stored = await Appointment.findById(inGrace._id);
    assert.equal(stored.status, "Waiting");
    assert.equal(stored.slotActive, true);
    assert.equal(
      await WaitingListEntry.countDocuments({ patient: patients[0]._id }),
      0
    );

    // Past the grace period, the same request is accepted.
    const outOfGrace = await book(
      patients[1],
      "09:20 AM",
      172,
      arrivedAfter("09:20 AM", 6)
    );

    const moved = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { appointmentId: String(outOfGrace._id) },
    });

    assert.equal(moved.status, 201, JSON.stringify(moved.body));
  });

  test("a patient inside the grace period keeps their queue position", async () => {
    // Q is booked 09:00 and arrived 09:05 - exactly at the edge. B is booked
    // 09:20 and arrived earlier. Q must still be called first.
    await book(
      patients[0],
      "09:00 AM",
      181,
      arrivedAfter("09:00 AM", 5)
    );
    await book(
      patients[1],
      "09:20 AM",
      182,
      arrivedAfter("09:20 AM", -20)
    );
    await book(
      patients[2],
      "09:40 AM",
      183,
      arrivedAfter("09:40 AM", -30)
    );

    const queue = await req("/doctor/live-queue", { token: asDoctor() });

    assert.deepEqual(
      queue.body.map((row) => row.slot),
      ["09:00 AM", "09:20 AM", "09:40 AM"],
      "appointment time still decides - grace does not reorder anything"
    );

    const next = await req("/doctor/dashboard/next-patient", {
      token: asDoctor(),
    });
    assert.equal(next.body.patient.slot, "09:00 AM");
  });

  // EC2 - lateness is REPORTED, never acted on.
  test("lateness is reported to reception and does nothing else", async () => {
    // It reaches reception's list.
    const booked = await book(patients[0], "12:01 AM", 141, null);
    const list = await req("/receptionist/appointments", {
      token: asReceptionist(),
    });

    const row = list.body.appointments.find(
      (a) => a._id === String(booked._id)
    );
    assert.ok(row, "the appointment is on reception's list");
    assert.equal(typeof row.isLateArrival, "boolean");
    assert.equal(typeof row.isOverdue, "boolean");
    assert.equal(list.body.graceMinutes, DEFAULT_GRACE_MINUTES);

    // And nothing acted on it.
    const stored = await Appointment.findById(booked._id);
    assert.equal(stored.status, "Waiting");
    assert.equal(stored.slotActive, true);
  });

  // EC17 - the fix. A cancelled assignment must not leave a stale entry.
  test("cancelling an assigned appointment releases the waiting list entry", async () => {
    const { slots } = await getDoctorDaySlots(doctor, new Date());

    // Assigning from the waiting list needs a slot that has not gone by, and
    // getDoctorDaySlots only ever offers future ones. After the clinic closes
    // there are none, which is a fact about the hour the suite ran - not a
    // defect - so this skips rather than failing, the same way the recovery
    // window tests do.
    if (!slots.length) {
      console.log("      SKIPPED: no free slots left today");
      return;
    }

    const added = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), phone: patients[0].phone },
    });
    assert.equal(added.status, 201);

    const assigned = await req(
      `/receptionist/waiting-list/${added.body.entry._id}/assign`,
      {
        method: "POST",
        token: asReceptionist(),
        body: { slot: slots[slots.length - 1] },
      }
    );
    assert.equal(assigned.status, 201);

    const entryId = added.body.entry._id;
    assert.equal(
      (await WaitingListEntry.findById(entryId)).status,
      "Assigned"
    );

    // X changes their mind.
    const cancelled = await req(
      `/receptionist/appointments/${assigned.body.appointment._id}/cancel`,
      { method: "PATCH", token: asReceptionist() }
    );
    assert.equal(cancelled.status, 200);

    // The slot is a vacancy again...
    const after = await getDoctorDaySlots(doctor, new Date());
    assert.ok(after.slots.includes(slots[slots.length - 1]));

    // ...and the entry no longer claims an assignment that does not exist.
    const entry = await WaitingListEntry.findById(entryId);
    assert.equal(
      entry.status,
      "Removed",
      "a cancelled assignment must not leave the entry marked Assigned"
    );
    assert.ok(entry.removedAt);

    // Which means they can be listed again if they come back.
    const again = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), phone: patients[0].phone },
    });
    assert.equal(again.status, 201);
  });

  // The receptionist's decision, both ways.
  test("reception chooses: keep in queue, or move to the waiting list", async () => {
    // Booked 09:00, arrives 09:05, and the previous patient is still inside.
    const late = await book(patients[0], "09:00 AM", 161, null);
    await book(patients[1], "09:20 AM", 162, minutesAgo(30), {
      status: "In Consultation",
      consultationStartedAt: minutesAgo(15),
    });

    // OPTION 1 - keep them in the normal queue. That is just check-in.
    const keep = await req(
      `/receptionist/appointments/${late._id}/check-in`,
      { method: "PATCH", token: asReceptionist(), body: { priority: "Normal" } }
    );
    assert.equal(keep.status, 200);

    let stored = await Appointment.findById(late._id);
    assert.ok(stored.checkedInAt, "checked in");
    assert.equal(stored.status, "Waiting");
    assert.equal(stored.slotActive, true, "keeps their slot");

    // And they are AHEAD of the 09:20 patient, despite arriving late.
    const queue = await req("/doctor/live-queue", { token: asDoctor() });
    assert.equal(
      queue.body[0]._id,
      String(late._id),
      "the 09:00 patient is still called before the 09:20 one"
    );

    // OPTION 2 - a genuinely too-late patient is moved instead.
    //
    // They have ARRIVED, forty minutes after their slot. The fixture used to
    // pass checkedInAt: null here and the move was accepted, because the
    // grace check was written as `if (checkedInAt) { ... }` and a missing
    // arrival skipped it entirely. That is now refused: you cannot hand a
    // vacancy to somebody who is not in the building.
    const tooLate = await book(
      patients[2],
      "09:40 AM",
      163,
      arrivedAfter("09:40 AM", 40)
    );

    const moved = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { appointmentId: String(tooLate._id) },
    });
    assert.equal(moved.status, 201, JSON.stringify(moved.body));
    assert.equal(moved.body.entry.reason, "Late arrival");

    // Their slot is released as a genuine vacancy...
    stored = await Appointment.findById(tooLate._id);
    assert.equal(stored.slotActive, false);

    // ...and they are NOT also sitting in the doctor's queue.
    const after = await req("/doctor/live-queue", { token: asDoctor() });
    assert.ok(
      !after.body.some((row) => row._id === String(tooLate._id)),
      "moved to the list means out of the normal queue - never both"
    );

    // Exactly one active waiting entry, and no second appointment.
    assert.equal(
      await WaitingListEntry.countDocuments({
        patient: patients[2]._id,
        status: "Waiting",
      }),
      1
    );
    assert.equal(
      await Appointment.countDocuments({
        patient: patients[2]._id,
        appointmentDate: today(),
        slotActive: true,
      }),
      0
    );
  });

  // KEEP IN QUEUE, as an explicit decision rather than an absence of one.
  //
  // The queue must come out of this completely unchanged - that IS the
  // decision. What changes is that reception has answered the question, so
  // the screen stops asking it.
  test("keeping a late patient in the queue changes nothing about the queue", async () => {
    const late = await book(
      patients[0],
      "09:00 AM",
      191,
      arrivedAfter("09:00 AM", 6)
    );
    const onTime = await book(
      patients[1],
      "09:20 AM",
      192,
      arrivedAfter("09:20 AM", 0)
    );

    const before = await Appointment.findById(late._id).lean();

    const kept = await req(
      `/receptionist/appointments/${late._id}/keep-in-queue`,
      { method: "PATCH", token: asReceptionist() }
    );

    assert.equal(kept.status, 200, JSON.stringify(kept.body));

    const after = await Appointment.findById(late._id);

    assert.ok(after.keptInQueueAt, "the decision must be recorded");

    // Everything that defines their place in the queue is untouched.
    assert.equal(after.status, before.status);
    assert.equal(after.slot, before.slot);
    assert.equal(after.slotActive, true, "they keep their slot");
    assert.equal(after.priority, before.priority);
    assert.equal(after.tokenNumber, before.tokenNumber);
    assert.equal(
      after.checkedInAt.getTime(),
      new Date(before.checkedInAt).getTime()
    );

    // No waiting-list entry, no vacancy.
    assert.equal(
      await WaitingListEntry.countDocuments({
        patient: patients[0]._id,
        status: "Waiting",
      }),
      0,
      "keeping a patient must not put them on the waiting list"
    );

    // And the 09:00 patient is still called before the 09:20 one - being
    // late did not push them to the back.
    const queue = await req("/doctor/live-queue", { token: asDoctor() });
    const ids = queue.body.map((row) => row._id);

    assert.ok(
      ids.indexOf(String(late._id)) < ids.indexOf(String(onTime._id)),
      "the late patient keeps their slot-ordered position"
    );
  });

  test("keeping a patient is idempotent", async () => {
    const late = await book(
      patients[0],
      "09:00 AM",
      193,
      arrivedAfter("09:00 AM", 12)
    );

    await req(`/receptionist/appointments/${late._id}/keep-in-queue`, {
      method: "PATCH",
      token: asReceptionist(),
    });

    const first = await Appointment.findById(late._id);

    const second = await req(
      `/receptionist/appointments/${late._id}/keep-in-queue`,
      { method: "PATCH", token: asReceptionist() }
    );

    assert.equal(second.status, 200);

    const again = await Appointment.findById(late._id);

    assert.equal(
      again.keptInQueueAt.getTime(),
      first.keptInQueueAt.getTime(),
      "a second press must not move the timestamp"
    );
  });

  // There is nothing to decide for a punctual patient, and recording one
  // would put a late-arrival note on their record.
  test("a patient inside the grace period cannot be kept, because they already are", async () => {
    const onTime = await book(
      patients[0],
      "09:00 AM",
      194,
      arrivedAfter("09:00 AM", 5)
    );

    const res = await req(
      `/receptionist/appointments/${onTime._id}/keep-in-queue`,
      { method: "PATCH", token: asReceptionist() }
    );

    assert.equal(res.status, 400);
    assert.match(res.body.message, /grace period/i);

    const stored = await Appointment.findById(onTime._id);
    assert.equal(stored.keptInQueueAt, null);
  });

  // Both halves of the decision are about a patient standing at the desk.
  test("a patient who never arrived can be neither kept nor moved", async () => {
    const absent = await book(patients[0], "09:00 AM", 195, null);

    const kept = await req(
      `/receptionist/appointments/${absent._id}/keep-in-queue`,
      { method: "PATCH", token: asReceptionist() }
    );

    assert.equal(kept.status, 400);
    assert.match(kept.body.message, /not checked in/i);

    const moved = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { appointmentId: String(absent._id) },
    });

    assert.equal(moved.status, 400, JSON.stringify(moved.body));
    assert.match(moved.body.message, /not checked in|no-show/i);

    // Their slot is untouched: an absent patient is overdue, not absent-
    // by-decision, and only a no-show frees a slot.
    const stored = await Appointment.findById(absent._id);
    assert.equal(stored.status, "Waiting");
    assert.equal(stored.slotActive, true);
    assert.equal(
      await WaitingListEntry.countDocuments({ patient: patients[0]._id }),
      0
    );
  });

  // The two options are mutually exclusive in effect: keeping a patient
  // leaves them in the queue, so the move must still be available afterwards
  // if reception changes their mind - but a moved patient is gone from the
  // queue and there is nothing left to keep.
  test("a patient kept in the queue can still be moved afterwards", async () => {
    const late = await book(
      patients[0],
      "09:00 AM",
      196,
      arrivedAfter("09:00 AM", 20)
    );

    await req(`/receptionist/appointments/${late._id}/keep-in-queue`, {
      method: "PATCH",
      token: asReceptionist(),
    });

    const moved = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { appointmentId: String(late._id) },
    });

    assert.equal(moved.status, 201, JSON.stringify(moved.body));

    const stored = await Appointment.findById(late._id);
    assert.equal(stored.slotActive, false, "the slot is released");

    // And now the decision is spent - the appointment is closed, so keeping
    // them is refused rather than silently doing nothing.
    const keptAgain = await req(
      `/receptionist/appointments/${late._id}/keep-in-queue`,
      { method: "PATCH", token: asReceptionist() }
    );

    assert.equal(keptAgain.status, 400);
  });

  // EC22 - a patient already with the doctor is not re-schedulable.
  test("a patient already in consultation cannot be moved or re-assigned", async () => {
    const inside = await book(patients[0], "09:00 AM", 151, minutesAgo(20), {
      status: "In Consultation",
      consultationStartedAt: minutesAgo(10),
    });

    // Moving them to the waiting list would release the slot from under the
    // doctor who is using it right now.
    const moved = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { appointmentId: String(inside._id) },
    });

    assert.equal(moved.status, 400);
    assert.match(moved.body.message, /already with the doctor/i);

    // The consultation is untouched - moving them would have released the
    // slot the doctor is using right now.
    const stored = await Appointment.findById(inside._id);
    assert.equal(stored.status, "In Consultation");
    assert.equal(stored.slotActive, true);
    assert.equal(
      await WaitingListEntry.countDocuments({ patient: patients[0]._id }),
      0
    );

    assert.equal(
      await Appointment.countDocuments({
        patient: patients[0]._id,
        appointmentDate: today(),
        slotActive: true,
      }),
      1,
      "never a second live appointment for the same patient"
    );
  });
});
