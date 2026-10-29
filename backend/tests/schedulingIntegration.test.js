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
const Appointment = require("../models/Appointment");
const BlockedSlot = require("../models/BlockedSlot");
const WaitingListEntry = require("../models/WaitingListEntry");
const { normalizeToIstDay } = require("../utils/istDay");
const { getDoctorDaySlots } = require("../utils/doctorAvailability");
const { slotToMinutes } = require("../utils/queueOrder");

// PHASE 11 - the scheduling half of the visit, end to end.
//
// endToEndVisit.test.js already carries one patient from booking through to a
// lab result. This carries the OTHER journey, the one that only existed as
// separate suites:
//
//   a patient no-shows            -> their slot becomes a real vacancy
//   a late patient is listed      -> waiting list, priority preserved
//   a walk-in is listed
//   the vacancy is filled         -> the HIGHEST PRIORITY patient gets it
//   the recovery window is used   -> for whoever is left, without moving
//                                    anyone already booked
//   the assigned patient is seen  -> an ordinary appointment, ordinary queue
//
// Uses its own doctor for the same reason recoveryWindow.test.js does: this
// suite blocks, books and frees slots across a whole day, which no other
// suite could survive running beside.
const PORT = 5076;
const BASE = `http://localhost:${PORT}`;
const PHONES = ["9990000081", "9990000082", "9990000083", "9990000084"];
const DOCTOR_EMAIL = "scheduling.integration.probe@example.invalid";

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

const asReceptionist = () =>
  jwt.sign(
    { receptionistId: String(receptionist._id), role: "receptionist" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );

const asDoctor = () =>
  jwt.sign({ doctorId: String(doctor._id), role: "doctor" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

const today = () => normalizeToIstDay(new Date());

async function freeSlots() {
  const { slots } = await getDoctorDaySlots(doctor, new Date());
  return slots;
}

// Carried between steps, so each one reads what the previous actually made.
const day = {};

describe("scheduling integration: no-show to waiting list to recovery", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    doctor = await Doctor.findOneAndUpdate(
      { email: DOCTOR_EMAIL },
      {
        $setOnInsert: {
          name: "Scheduling Integration Probe",
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
              name: `Scheduling Probe ${i + 1}`,
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

  after(async () => {
    await WaitingListEntry.deleteMany({
      patient: { $in: patients.map((p) => p._id) },
    });
    await Appointment.deleteMany({ doctorId: doctor._id });
    await BlockedSlot.deleteMany({ doctorId: doctor._id });
    await Patient.deleteMany({ phone: { $in: PHONES } });
    await Doctor.deleteOne({ email: DOCTOR_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("1. the day is set up: three booked, a recovery window open", async () => {
    const open = await freeSlots();

    // Needs three bookings plus a three-slot recovery window, and slots for
    // today are filtered to the future - so late in the evening there is
    // genuinely not enough day left. Skipped rather than asserted, the way
    // every other slot-dependent suite here handles it: a test that fails
    // because of the clock teaches nothing and trains people to ignore red.
    if (open.length < 7) {
      day.skipped = `only ${open.length} slots left today - not enough day remaining`;
      console.log(`      SKIPPED: ${day.skipped}`);
      return;
    }

    // Three ordinary bookings.
    day.booked = open.slice(0, 3);

    for (let i = 0; i < 3; i++) {
      await Appointment.create({
        patient: patients[i]._id,
        patientName: patients[i].name,
        phone: patients[i].phone,
        age: 40 + i,
        gender: "Male",
        doctorId: doctor._id,
        appointmentDate: today(),
        slot: day.booked[i],
        symptoms: "automated test",
        status: "Waiting",
        tokenNumber: 6100 + i,
      });
    }

    // A recovery window over the last two slots of the day.
    const remaining = await freeSlots();
    // Three slots: one for the late patient, one for the later arrival, and
    // one left over to prove the rest of the window stays held.
    day.recovery = remaining.slice(-3);

    const window = await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: {
        doctorId: String(doctor._id),
        start: day.recovery[0],
        end: "11:59 PM",
      },
    });
    assert.equal(window.status, 201, JSON.stringify(window.body));

    // What a patient can still book: not the bookings, not the recovery
    // window.
    const bookable = await freeSlots();

    for (const slot of [...day.booked, ...day.recovery]) {
      assert.ok(
        !bookable.includes(slot),
        `${slot} must not be offered to a patient`
      );
    }
  });

  test("2. a no-show frees a slot; being late does not", async () => {
    if (day.skipped) return;

    // The first patient is simply late. Nothing may touch their booking.
    const late = await Appointment.findOne({
      doctorId: doctor._id,
      slot: day.booked[0],
    });

    assert.equal(late.status, "Waiting");
    assert.equal(late.slotActive, true, "a late patient still holds their slot");

    // The second never arrived. Reception says so - the clock does not.
    const absent = await Appointment.findOne({
      doctorId: doctor._id,
      slot: day.booked[1],
    });

    const noShow = await req(
      `/receptionist/appointments/${absent._id}/no-show`,
      { method: "PATCH", token: asReceptionist() }
    );
    assert.equal(noShow.status, 200);

    const freed = await Appointment.findById(absent._id);
    assert.equal(freed.status, "Cancelled");
    assert.ok(freed.noShowAt, "distinguishable from a plain cancellation");
    assert.equal(freed.slotActive, false);

    // That slot, and only that slot, is now a vacancy.
    const bookable = await freeSlots();
    assert.ok(bookable.includes(day.booked[1]), "the no-show's slot is free");
    assert.ok(!bookable.includes(day.booked[0]), "the late patient keeps theirs");
    assert.ok(!bookable.includes(day.booked[2]));

    day.vacancy = day.booked[1];
  });

  test("3. the late patient and a walk-in go on the waiting list, in priority order", async () => {
    if (day.skipped) return;

    // The late patient is now too late for their slot, so reception moves
    // them across. Their appointment is the source, so the two stay linked.
    const late = await Appointment.findOne({
      doctorId: doctor._id,
      slot: day.booked[0],
    });

    // They have to have ARRIVED to be moved - you cannot hand a vacancy to
    // somebody who is not in the building. This step used to move a patient
    // who had never checked in, which the server accepted only because the
    // grace check was skipped when checkedInAt was null. The narrative said
    // "the late patient"; the data said nobody had turned up.
    late.checkedInAt = new Date(
      normalizeToIstDay(new Date()).getTime() +
        (slotToMinutes(day.booked[0]) + 30) * 60 * 1000
    );
    await late.save();

    const moved = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { appointmentId: String(late._id) },
    });
    assert.equal(moved.status, 201);
    assert.equal(moved.body.entry.reason, "Late arrival");

    // A walk-in arrives afterwards - but is an emergency.
    const walkIn = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: {
        doctorId: String(doctor._id),
        phone: patients[3].phone,
        priorityReason: "Emergency",
      },
    });
    assert.equal(walkIn.status, 201);
    assert.equal(walkIn.body.entry.priority, "High");

    const list = await req(
      `/receptionist/waiting-list?doctorId=${doctor._id}`,
      { token: asReceptionist() }
    );

    assert.equal(list.body.entries.length, 2);
    assert.equal(
      list.body.entries[0].phone,
      PHONES[3],
      "the emergency is first despite arriving last"
    );

    day.emergencyPhone = PHONES[3];
    day.latePhone = PHONES[0];
  });

  test("4. the vacancy goes to the HIGHEST PRIORITY patient, not the first clicked", async () => {
    if (day.skipped) return;

    const assigned = await req("/receptionist/waiting-list/assign-next", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), slot: day.vacancy },
    });

    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
    assert.equal(
      assigned.body.appointment.phone,
      day.emergencyPhone,
      "the emergency gets the slot, not whoever was listed first"
    );

    const appointment = await Appointment.findById(
      assigned.body.appointment._id
    );
    assert.equal(appointment.slot, day.vacancy);
    assert.equal(appointment.priority, "High", "priority carries across");
    assert.ok(appointment.tokenNumber, "an ordinary booking with a token");

    // Off the list; the late patient is now at the front.
    const list = await req(
      `/receptionist/waiting-list?doctorId=${doctor._id}`,
      { token: asReceptionist() }
    );
    assert.equal(list.body.entries.length, 1);
    assert.equal(list.body.entries[0].phone, day.latePhone);
  });

  test("5. the late patient is offered recovery capacity, and nobody is moved", async () => {
    if (day.skipped) return;

    // Read what is ACTUALLY held right now rather than assuming an index -
    // earlier steps consume capacity, and an index that was right in step 1
    // is not necessarily right here.
    const vacancies = await req(
      `/receptionist/vacancies?doctorId=${doctor._id}`,
      { token: asReceptionist() }
    );
    const recoveryNow = vacancies.body.recoverySlots;
    assert.ok(recoveryNow.length >= 2, "the window should still hold capacity");

    const before = await Appointment.find({
      doctorId: doctor._id,
      slotActive: true,
    })
      .select("slot tokenNumber phone")
      .lean();

    const assigned = await req("/receptionist/waiting-list/assign-next", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), slot: recoveryNow[0] },
    });

    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
    assert.equal(assigned.body.appointment.phone, day.latePhone);
    assert.equal(assigned.body.appointment.slot, recoveryNow[0]);

    // NOTHING else moved. This is the whole point of holding capacity back
    // rather than shifting the schedule.
    for (const previous of before) {
      const now = await Appointment.findOne({
        doctorId: doctor._id,
        phone: previous.phone,
        slot: previous.slot,
      });
      assert.ok(now, `${previous.phone} still holds ${previous.slot}`);
      assert.equal(now.tokenNumber, previous.tokenNumber);
    }

    // The reservation is consumed, not left behind.
    assert.equal(
      await BlockedSlot.countDocuments({
        doctorId: doctor._id,
        date: today(),
        slot: recoveryNow[0],
        isRecovery: true,
      }),
      0
    );

    // And the list is empty.
    const list = await req(
      `/receptionist/waiting-list?doctorId=${doctor._id}`,
      { token: asReceptionist() }
    );
    assert.equal(list.body.entries.length, 0);
  });

  test("6. a later arrival uses the RECOVERY window", async () => {
    if (day.skipped) return;

    const stillHeld = await req(
      `/receptionist/vacancies?doctorId=${doctor._id}`,
      { token: asReceptionist() }
    );
    const recoveryLeft = stillHeld.body.recoverySlots;
    assert.ok(recoveryLeft.length >= 1, "capacity remains for a later arrival");

    // Somebody turns up at the end of the session with no slot left.
    const added = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), phone: patients[2].phone },
    });

    // patients[2] already holds an ordinary booking, so they are refused a
    // second live slot - exactly the duplicate rule, firing in a real flow.
    if (added.status === 201) {
      const blocked = await req("/receptionist/waiting-list/assign-next", {
        method: "POST",
        token: asReceptionist(),
        body: { doctorId: String(doctor._id), slot: recoveryLeft[0] },
      });
      assert.equal(
        blocked.status,
        409,
        "a patient already holding a live slot today is not given a second"
      );

      await req(
        `/receptionist/waiting-list/${added.body.entry._id}/remove`,
        { method: "PATCH", token: asReceptionist() }
      );
    }

    // The no-show patient is back and wants to be seen after all.
    const returning = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), phone: patients[1].phone },
    });
    assert.equal(returning.status, 201, JSON.stringify(returning.body));

    const assigned = await req("/receptionist/waiting-list/assign-next", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), slot: recoveryLeft[0] },
    });

    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
    assert.equal(assigned.body.appointment.slot, recoveryLeft[0]);

    // One recovery slot consumed, the rest of the window still held.
    assert.equal(
      await BlockedSlot.countDocuments({
        doctorId: doctor._id,
        date: today(),
        isRecovery: true,
      }),
      recoveryLeft.length - 1,
      "the rest of the window is still protected"
    );

    day.recoveryAppointmentId = assigned.body.appointment._id;
  });

  test("7. a recovery patient is an ordinary patient from here on", async () => {
    if (day.skipped) return;

    // Checked in, queued, consulted - through the same endpoints as anyone
    // else. There is no second appointment system.
    const checkedIn = await req(
      `/receptionist/appointments/${day.recoveryAppointmentId}/check-in`,
      { method: "PATCH", token: asReceptionist(), body: { priority: "Normal" } }
    );
    assert.equal(checkedIn.status, 200);

    const queue = await req("/doctor/live-queue", { token: asDoctor() });
    assert.ok(
      queue.body.some((row) => row._id === day.recoveryAppointmentId),
      "they appear in the doctor's queue like any other patient"
    );

    const started = await req(
      `/doctor/appointments/${day.recoveryAppointmentId}/start-consultation`,
      { method: "PATCH", token: asDoctor() }
    );
    assert.equal(started.status, 200);

    const stored = await Appointment.findById(day.recoveryAppointmentId);
    assert.equal(stored.status, "In Consultation");
  });

  test("8. the day adds up, and nothing was double booked", async () => {
    if (day.skipped) return;

    const live = await Appointment.find({
      doctorId: doctor._id,
      appointmentDate: today(),
      slotActive: true,
    })
      .select("slot phone")
      .lean();

    // One live appointment per slot - the invariant every path in this file
    // has been pushing against.
    const slots = live.map((a) => a.slot);
    assert.equal(
      new Set(slots).size,
      slots.length,
      "no slot may be held by two live appointments"
    );

    // The no-show is still recorded, released, and not double counted.
    const noShow = await Appointment.findOne({
      doctorId: doctor._id,
      slot: day.vacancy,
      noShowAt: { $ne: null },
    });
    assert.ok(noShow, "the no-show record survives");
    assert.equal(noShow.slotActive, false);

    // And its slot is held by exactly one live appointment - the emergency.
    const inVacancy = live.filter((a) => a.slot === day.vacancy);
    assert.equal(inVacancy.length, 1);
    assert.equal(inVacancy[0].phone, day.emergencyPhone);

    // Nobody on the waiting list is left in limbo.
    assert.equal(
      await WaitingListEntry.countDocuments({
        doctorId: doctor._id,
        date: today(),
        status: "Waiting",
      }),
      0
    );
  });
});
