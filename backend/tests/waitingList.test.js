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

// The waiting/vacant list.
//
// The rule this whole feature turns on, and the first thing these assert:
// A SLOT TIME PASSING IS NOT A NO-SHOW. A patient stuck in traffic is late,
// not absent. Only a receptionist can say the patient is not there.
//
// After that it is almost entirely duplicate-prevention, because every failure
// mode here is a double: the same patient listed twice, the same vacancy given
// to two people, one patient holding two slots, an entry assigned twice.
const PORT = 5081;
const BASE = `http://localhost:${PORT}`;
// A reserved block, so a crashed run can never be confused with real data.
const PHONES = ["9990000041", "9990000042", "9990000043"];

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

// A booked appointment for today. `slot` is a synthetic label unless a real
// free one is asked for, so these never collide with genuine bookings.
async function makeAppointment(patient, overrides = {}) {
  return Appointment.create({
    patient: patient._id,
    patientName: patient.name,
    phone: patient.phone,
    age: 40,
    gender: "Female",
    doctorId: doctor._id,
    appointmentDate: normalizeToIstDay(new Date()),
    slot: `wl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    symptoms: "automated test",
    status: "Waiting",
    tokenNumber: 8000 + Math.floor(Math.random() * 900),
    ...overrides,
  });
}

async function addWalkIn(patient, body = {}) {
  return req("/receptionist/waiting-list", {
    method: "POST",
    token: asReceptionist(),
    body: { doctorId: String(doctor._id), phone: patient.phone, ...body },
  });
}

async function clearFixtures() {
  const appointments = await Appointment.find({
    phone: { $in: PHONES },
  }).select("_id");

  await WaitingListEntry.deleteMany({
    patient: { $in: patients.map((p) => p._id) },
  });
  await Appointment.deleteMany({ phone: { $in: PHONES } });
  return appointments;
}

describe("waiting / vacant list", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    // The FIRST available doctor. flexSlots.test.js deliberately takes the
    // second - see the note there.
    doctor = await Doctor.findOne({ isAvailable: true });
    receptionist = await Receptionist.findOne();

    assert.ok(doctor, "needs an available doctor");
    assert.ok(receptionist, "needs a receptionist");

    patients = [];
    for (let i = 0; i < PHONES.length; i++) {
      patients.push(
        await Patient.findOneAndUpdate(
          { phone: PHONES[i] },
          {
            $setOnInsert: {
              name: `Waiting Probe ${i + 1}`,
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

  // The list is per doctor per day, so entries from one test would otherwise
  // count towards the next one's capacity and ordering.
  beforeEach(clearFixtures);

  after(async () => {
    await clearFixtures();
    await Patient.deleteMany({ phone: { $in: PHONES } });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("a slot time passing does NOT cancel the appointment", async () => {
    // The 10:00 patient turning up at 10:20 because of traffic. Nothing may
    // touch their booking on account of the clock.
    const appointment = await makeAppointment(patients[0]);

    // A restart is when the expiry routine runs, so this covers it too.
    const list = await req("/receptionist/waiting-list", {
      token: asReceptionist(),
    });
    assert.equal(list.status, 200);

    const stored = await Appointment.findById(appointment._id);
    assert.equal(stored.status, "Waiting", "a late patient is still waiting");
    assert.equal(stored.slotActive, true, "and still holds their slot");
    assert.equal(stored.noShowAt, null);

    // They can still be checked in and seen, exactly as before.
    const checkedIn = await req(
      `/receptionist/appointments/${appointment._id}/check-in`,
      { method: "PATCH", token: asReceptionist(), body: { priority: "Normal" } }
    );
    assert.equal(checkedIn.status, 200, "a late arrival can still be checked in");
  });

  test("a checked-in patient cannot be marked a no-show", async () => {
    const appointment = await makeAppointment(patients[0], {
      checkedInAt: new Date(),
    });

    const res = await req(
      `/receptionist/appointments/${appointment._id}/no-show`,
      { method: "PATCH", token: asReceptionist() }
    );

    assert.equal(res.status, 400);
    assert.match(res.body.message, /already checked in/i);
    assert.equal((await Appointment.findById(appointment._id)).status, "Waiting");
  });

  test("marking a no-show frees the slot", async () => {
    const appointment = await makeAppointment(patients[0]);

    const res = await req(
      `/receptionist/appointments/${appointment._id}/no-show`,
      { method: "PATCH", token: asReceptionist() }
    );
    assert.equal(res.status, 200);

    const stored = await Appointment.findById(appointment._id);
    assert.equal(stored.status, "Cancelled");
    assert.ok(stored.noShowAt, "a no-show is distinguishable from a cancellation");
    assert.ok(stored.cancelledAt);
    assert.equal(
      stored.slotActive,
      false,
      "releasing the slot is what makes this a vacancy - the pre-save hook must run"
    );

    // Closed records cannot be re-marked.
    const again = await req(
      `/receptionist/appointments/${appointment._id}/no-show`,
      { method: "PATCH", token: asReceptionist() }
    );
    assert.equal(again.status, 400);
  });

  test("the list holds at most six patients", async () => {
    // Six distinct patients, created just for this test.
    const extras = [];
    for (let i = 0; i < 7; i++) {
      extras.push(
        await Patient.findOneAndUpdate(
          { phone: `99900001${String(i).padStart(2, "0")}` },
          {
            $setOnInsert: {
              name: `Capacity Probe ${i}`,
              phone: `99900001${String(i).padStart(2, "0")}`,
              email: `cap.${i}@example.invalid`,
              password: "x",
            },
          },
          { upsert: true, new: true }
        )
      );
    }

    try {
      // This runs against the shared database, where a REAL patient may
      // already be waiting for this doctor. Filling from the current count
      // rather than from zero means the test measures the cap itself, not
      // whether the list happened to be empty - and it never has to delete
      // somebody's genuine entry to pass.
      const before = await req(
        `/receptionist/waiting-list?doctorId=${doctor._id}`,
        { token: asReceptionist() }
      );

      const max = before.body.maxWaiting;
      const alreadyWaiting = before.body.entries.length;
      const room = max - alreadyWaiting;

      assert.ok(
        room <= extras.length,
        "this test needs enough spare fixtures to fill the list"
      );

      for (let i = 0; i < room; i++) {
        const res = await req("/receptionist/waiting-list", {
          method: "POST",
          token: asReceptionist(),
          body: { doctorId: String(doctor._id), phone: extras[i].phone },
        });
        assert.equal(res.status, 201, `patient ${i + 1} should fit`);
      }

      // One past the cap, whoever filled it.
      const overflow = await req("/receptionist/waiting-list", {
        method: "POST",
        token: asReceptionist(),
        body: { doctorId: String(doctor._id), phone: extras[room].phone },
      });

      assert.equal(overflow.status, 409);
      assert.match(overflow.body.message, /full/i);

      const list = await req(
        `/receptionist/waiting-list?doctorId=${doctor._id}`,
        { token: asReceptionist() }
      );
      assert.equal(list.body.entries.length, max);
      assert.equal(max, 6);
    } finally {
      await WaitingListEntry.deleteMany({
        patient: { $in: extras.map((p) => p._id) },
      });
      await Patient.deleteMany({ _id: { $in: extras.map((p) => p._id) } });
    }
  });

  test("the same patient cannot be listed twice", async () => {
    const first = await addWalkIn(patients[0]);
    assert.equal(first.status, 201);

    const duplicate = await addWalkIn(patients[0]);
    assert.equal(duplicate.status, 409);
    assert.match(duplicate.body.message, /already on/i);

    assert.equal(
      await WaitingListEntry.countDocuments({
        patient: patients[0]._id,
        status: "Waiting",
      }),
      1
    );
  });

  test("priority is kept, and the list is ordered by it then by arrival", async () => {
    await addWalkIn(patients[0]);
    await new Promise((r) => setTimeout(r, 15));
    await addWalkIn(patients[1]);
    await new Promise((r) => setTimeout(r, 15));

    // A reason forces High, the same rule check-in applies to appointments.
    const third = await addWalkIn(patients[2], {
      priorityReason: "Emergency",
    });
    assert.equal(third.status, 201);
    assert.equal(third.body.entry.priority, "High");

    const list = await req(`/receptionist/waiting-list?doctorId=${doctor._id}`, {
      token: asReceptionist(),
    });

    // Filtered to this suite's own patients: the assertion is about the
    // ORDERING RULE, and an unrelated entry sitting between them would break
    // it without anything being wrong.
    const order = list.body.entries
      .map((e) => e.phone)
      .filter((phone) => PHONES.includes(phone));
    assert.equal(
      order[0],
      PHONES[2],
      "the emergency goes first despite arriving last"
    );
    assert.deepEqual(
      order.slice(1),
      [PHONES[0], PHONES[1]],
      "the rest keep the order they arrived in"
    );
  });

  test("a late patient can be moved from their appointment onto the list", async () => {
    // ARRIVED, and past the grace period. The fixture used to leave
    // checkedInAt null and the move was still accepted, because the grace
    // check only ran `if (checkedInAt)` - so a patient who never turned up
    // skipped it entirely. The test was named "a late patient" while
    // describing an absent one.
    //
    // The synthetic slot label resolves to minute 0 of the IST day (see
    // slotToMinutes, which returns 0 for anything it cannot parse), so an
    // arrival of "now" is always comfortably past the grace period.
    const appointment = await makeAppointment(patients[0], {
      checkedInAt: new Date(),
    });

    const res = await req("/receptionist/waiting-list", {
      method: "POST",
      token: asReceptionist(),
      body: { appointmentId: String(appointment._id) },
    });

    assert.equal(res.status, 201);
    assert.equal(res.body.entry.reason, "Late arrival");
    assert.equal(
      String(res.body.entry.sourceAppointmentId),
      String(appointment._id),
      "the entry stays connected to the appointment it came from"
    );

    // MOVING means giving up the slot. Leaving it held blocked it for
    // everyone else AND left the patient unable to be assigned a new one,
    // because the duplicate guard correctly refuses a second live
    // appointment - so they were stuck on the list they had just joined.
    const source = await Appointment.findById(appointment._id);
    assert.equal(source.status, "Cancelled");
    assert.equal(
      source.slotActive,
      false,
      "the slot they could not use becomes a vacancy"
    );

    // And they can now actually be given one.
    const { slots } = await getDoctorDaySlots(doctor, new Date());

    if (slots.length) {
      const assigned = await req(
        `/receptionist/waiting-list/${res.body.entry._id}/assign`,
        {
          method: "POST",
          token: asReceptionist(),
          body: { slot: slots[slots.length - 1] },
        }
      );
      assert.equal(assigned.status, 201, JSON.stringify(assigned.body));
    }
  });

  test("assigning a vacancy books the patient and takes them off the list", async () => {
    const { slots } = await getDoctorDaySlots(doctor, new Date());

    if (!slots.length) {
      console.log("      SKIPPED: the doctor has no free slot left today");
      return;
    }

    const slot = slots[slots.length - 1];

    const added = await addWalkIn(patients[0]);
    const entryId = added.body.entry._id;

    const assigned = await req(
      `/receptionist/waiting-list/${entryId}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot } }
    );

    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));

    const appointment = await Appointment.findById(assigned.body.appointment._id);
    assert.ok(appointment, "a real appointment is created");
    assert.equal(appointment.slot, slot);
    assert.equal(appointment.status, "Waiting");
    assert.equal(String(appointment.patient), String(patients[0]._id));
    assert.ok(appointment.tokenNumber, "and it gets a token like any booking");

    const entry = await WaitingListEntry.findById(entryId);
    assert.equal(entry.status, "Assigned");
    assert.equal(
      String(entry.assignedAppointmentId),
      String(appointment._id)
    );

    // Off the list.
    const list = await req(`/receptionist/waiting-list?doctorId=${doctor._id}`, {
      token: asReceptionist(),
    });
    assert.ok(!list.body.entries.some((e) => e._id === entryId));

    // And the slot is no longer offered as a vacancy.
    const vacancies = await req(
      `/receptionist/vacancies?doctorId=${doctor._id}`,
      { token: asReceptionist() }
    );
    assert.ok(!vacancies.body.slots.includes(slot));
  });

  test("one vacancy cannot be given to two patients, or to one twice", async () => {
    const { slots } = await getDoctorDaySlots(doctor, new Date());

    if (!slots.length) {
      console.log("      SKIPPED: the doctor has no free slot left today");
      return;
    }

    const slot = slots[slots.length - 1];

    const first = await addWalkIn(patients[0]);
    const second = await addWalkIn(patients[1]);

    const assigned = await req(
      `/receptionist/waiting-list/${first.body.entry._id}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot } }
    );
    assert.equal(assigned.status, 201);

    // The same slot, a different patient.
    const stolen = await req(
      `/receptionist/waiting-list/${second.body.entry._id}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot } }
    );
    assert.equal(stolen.status, 409, "a vacancy cannot be filled twice");

    // The same entry, again.
    const twice = await req(
      `/receptionist/waiting-list/${first.body.entry._id}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot } }
    );
    assert.equal(twice.status, 409, "an entry cannot be assigned twice");

    // Scoped to TODAY. The invariant is per doctor per DAY per slot - that is
    // what the partial unique index enforces - so counting the slot label
    // across every day also picks up unrelated live bookings at the same time
    // on other dates, which is not a double booking at all.
    const today = normalizeToIstDay(new Date());

    assert.equal(
      await Appointment.countDocuments({
        doctorId: doctor._id,
        appointmentDate: today,
        slot,
        slotActive: true,
      }),
      1,
      "exactly one live appointment holds that slot today"
    );
  });

  test("a patient who already holds a slot today is not given a second", async () => {
    const { slots } = await getDoctorDaySlots(doctor, new Date());

    if (!slots.length) {
      console.log("      SKIPPED: the doctor has no free slot left today");
      return;
    }

    // They already have a live booking with this doctor today.
    await makeAppointment(patients[0]);

    const added = await addWalkIn(patients[0]);
    const res = await req(
      `/receptionist/waiting-list/${added.body.entry._id}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot: slots[slots.length - 1] } }
    );

    assert.equal(res.status, 409);
    assert.match(res.body.message, /already has a live appointment/i);
  });

  test("a slot that is not actually free is refused", async () => {
    const added = await addWalkIn(patients[0]);

    const res = await req(
      `/receptionist/waiting-list/${added.body.entry._id}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot: "99:99 XX" } }
    );

    assert.equal(res.status, 409);
    assert.equal(
      await WaitingListEntry.findById(added.body.entry._id).then((e) => e.status),
      "Waiting",
      "a refused assignment leaves the patient on the list"
    );
  });

  test("removing keeps the record and frees the patient to be re-added", async () => {
    const added = await addWalkIn(patients[0]);
    const entryId = added.body.entry._id;

    const removed = await req(
      `/receptionist/waiting-list/${entryId}/remove`,
      { method: "PATCH", token: asReceptionist() }
    );
    assert.equal(removed.status, 200);

    const entry = await WaitingListEntry.findById(entryId);
    assert.ok(entry, "removed, not deleted - that they waited is part of the day");
    assert.equal(entry.status, "Removed");

    // The partial unique index only covers "Waiting", so they can come back.
    const again = await addWalkIn(patients[0]);
    assert.equal(again.status, 201);
  });

  test("an assigned patient leaves the list and cannot be cancelled through it", async () => {
    const { slots } = await getDoctorDaySlots(doctor, new Date());

    if (!slots.length) {
      console.log("      SKIPPED: the doctor has no free slot left today");
      return;
    }

    const first = await addWalkIn(patients[0]);
    const second = await addWalkIn(patients[1]);

    const assigned = await req(
      `/receptionist/waiting-list/${first.body.entry._id}/assign`,
      {
        method: "POST",
        token: asReceptionist(),
        body: { slot: slots[slots.length - 1] },
      }
    );
    assert.equal(assigned.status, 201);

    // GONE from the active list - the backend state, not just the UI.
    const list = await req(`/receptionist/waiting-list?doctorId=${doctor._id}`, {
      token: asReceptionist(),
    });

    const ids = list.body.entries.map((e) => e._id);
    assert.ok(
      !ids.includes(first.body.entry._id),
      "an assigned patient must not still be an active waiting entry"
    );
    assert.ok(
      ids.includes(second.body.entry._id),
      "and the next patient is still waiting"
    );

    // The entry is consumed, not deleted.
    const entry = await WaitingListEntry.findById(first.body.entry._id);
    assert.equal(entry.status, "Assigned");

    // The waiting-list cancel action must not be able to reach their new
    // appointment. Without this, a stale row could cancel a real booking.
    const cancelThroughList = await req(
      `/receptionist/waiting-list/${first.body.entry._id}/remove`,
      { method: "PATCH", token: asReceptionist() }
    );
    assert.equal(cancelThroughList.status, 400);

    const appointment = await Appointment.findById(
      assigned.body.appointment._id
    );
    assert.equal(
      appointment.status,
      "Waiting",
      "their appointment is untouched by the waiting-list control"
    );
    assert.equal(appointment.slotActive, true);

    // Exactly one active representation: one live appointment, no active
    // waiting entry.
    assert.equal(
      await Appointment.countDocuments({
        patient: patients[0]._id,
        appointmentDate: normalizeToIstDay(new Date()),
        slotActive: true,
      }),
      1
    );
    assert.equal(
      await WaitingListEntry.countDocuments({
        patient: patients[0]._id,
        status: "Waiting",
      }),
      0
    );
  });

  test("only reception can work the list", async () => {
    const added = await addWalkIn(patients[0]);

    for (const [method, pathname, body] of [
      ["GET", "/receptionist/waiting-list", undefined],
      [
        "POST",
        "/receptionist/waiting-list",
        { doctorId: String(doctor._id), phone: PHONES[1] },
      ],
      ["PATCH", `/receptionist/waiting-list/${added.body.entry._id}/remove`, {}],
    ]) {
      const asOtherRole = await req(pathname, {
        method,
        token: asDoctor(),
        body,
      });
      assert.equal(asOtherRole.status, 403, `${method} ${pathname}`);

      const anonymous = await req(pathname, { method, body });
      assert.equal(anonymous.status, 401, `${method} ${pathname} (anonymous)`);
    }

    assert.equal(
      await WaitingListEntry.countDocuments({ status: "Waiting", patient: patients[1]._id }),
      0,
      "nothing refused may have created an entry"
    );
  });
});
