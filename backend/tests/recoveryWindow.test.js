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
const BlockedSlot = require("../models/BlockedSlot");
const WaitingListEntry = require("../models/WaitingListEntry");
const { normalizeToIstDay } = require("../utils/istDay");
const { getDoctorDaySlots } = require("../utils/doctorAvailability");

// The recovery window.
//
//   8 AM - 12 PM   normal appointments   (protected)
//   12 PM - 1 PM   recovery window       (waiting-list patients only)
//
// It is the BlockedSlot mechanism, one block per slot - which is
// the point: the patient booking path already refuses a block, and a recovery
// booking is an ORDINARY Appointment created through the ordinary assign path.
// There is no second appointment system, and these assert that.
//
// Creates and removes its OWN doctor. waitingList.test.js takes the first
// real doctor; with only two in the database this suite fell back onto one of
// them, and two suites holding blocks on one schedule at the same time made
// "every slot outside the window is unchanged" fail intermittently. A
// throwaway doctor removes the contention entirely - same pattern as the
// throwaway nurse and technician the other suites use, and it is deleted in
// `after`.
const PORT = 5077;
const BASE = `http://localhost:${PORT}`;
const PHONES = ["9990000071", "9990000072"];
const DOCTOR_EMAIL = "recovery.window.probe@example.invalid";

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

function slotToMinutes(slot) {
  const [time, meridiem] = slot.split(" ");
  let [hours, minutes] = time.split(":").map(Number);
  if (meridiem.toUpperCase() === "PM" && hours !== 12) hours += 12;
  if (meridiem.toUpperCase() === "AM" && hours === 12) hours = 0;
  return hours * 60 + minutes;
}

function toLabel(minutes) {
  const h24 = Math.floor(minutes / 60);
  const m = minutes % 60;
  const meridiem = h24 >= 12 ? "PM" : "AM";
  let h = h24 % 12;
  if (h === 0) h = 12;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} ${meridiem}`;
}

async function freeSlots() {
  const { slots } = await getDoctorDaySlots(doctor, new Date());
  return slots;
}

async function addWalkIn(patient) {
  return req("/receptionist/waiting-list", {
    method: "POST",
    token: asReceptionist(),
    body: { doctorId: String(doctor._id), phone: patient.phone },
  });
}

// The window covers the LAST few free slots of the day, so it behaves like a
// real end-of-session recovery period without depending on the clock.
async function windowOverLastSlots(count = 2) {
  const open = await freeSlots();
  if (open.length < count + 1) return null;

  const windowSlots = open.slice(-count);
  const start = toLabel(slotToMinutes(windowSlots[0]));
  const end = toLabel(slotToMinutes(windowSlots[windowSlots.length - 1]) + 1);

  return { windowSlots, start, end, protectedSlots: open.slice(0, -count) };
}

async function clearFixtures() {
  await WaitingListEntry.deleteMany({
    patient: { $in: patients.map((p) => p._id) },
  });
  await Appointment.deleteMany({ phone: { $in: PHONES } });
  await BlockedSlot.deleteMany({ doctorId: doctor?._id, isRecovery: true });
}

describe("recovery window", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    // Working hours wide enough that there are always free slots left, so the
    // suite does not skip itself depending on the time of day.
    doctor = await Doctor.findOneAndUpdate(
      { email: DOCTOR_EMAIL },
      {
        $setOnInsert: {
          name: "Recovery Window Probe",
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

    assert.ok(doctor, "needs an available doctor");
    assert.ok(receptionist, "needs a receptionist");

    patients = [];
    for (let i = 0; i < PHONES.length; i++) {
      patients.push(
        await Patient.findOneAndUpdate(
          { phone: PHONES[i] },
          {
            $setOnInsert: {
              name: `Recovery Probe ${i + 1}`,
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

  beforeEach(clearFixtures);

  after(async () => {
    await clearFixtures();
    await Patient.deleteMany({ phone: { $in: PHONES } });
    await Appointment.deleteMany({ doctorId: doctor._id });
    await BlockedSlot.deleteMany({ doctorId: doctor._id });
    await Doctor.deleteOne({ email: DOCTOR_EMAIL });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("opening a window holds its slots and protects everything else", async () => {
    const plan = await windowOverLastSlots(2);

    if (!plan) {
      console.log("      SKIPPED: not enough free slots left today");
      return;
    }

    const opened = await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: {
        doctorId: String(doctor._id),
        start: plan.start,
        end: plan.end,
      },
    });

    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.deepEqual(opened.body.recoverySlots, plan.windowSlots);

    const after = await getDoctorDaySlots(doctor, new Date());

    // Held back from patients...
    for (const slot of plan.windowSlots) {
      assert.ok(
        !after.slots.includes(slot),
        `${slot} must not be offered to a patient`
      );
      assert.ok(after.recoverySlots.includes(slot), `${slot} is in the window`);
    }

    // ...and every slot OUTSIDE the window is exactly as it was. The window
    // protects remaining capacity; it never disturbs the normal session.
    assert.deepEqual(
      after.slots,
      plan.protectedSlots,
      "normal appointment slots must be untouched"
    );
  });

  test("a waiting patient can be given a recovery slot, as an ordinary appointment", async () => {
    const plan = await windowOverLastSlots(2);

    if (!plan) {
      console.log("      SKIPPED: not enough free slots left today");
      return;
    }

    // Somebody holds a normal slot before the window. They must be untouched.
    const normal = await Appointment.create({
      patient: patients[1]._id,
      patientName: patients[1].name,
      phone: patients[1].phone,
      age: 36,
      gender: "Male",
      doctorId: doctor._id,
      appointmentDate: today(),
      slot: plan.protectedSlots[0],
      symptoms: "automated test",
      status: "Waiting",
      tokenNumber: 7500,
    });

    await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), start: plan.start, end: plan.end },
    });

    const entry = await addWalkIn(patients[0]);
    assert.equal(entry.status, 201);

    const slot = plan.windowSlots[0];

    const assigned = await req(
      `/receptionist/waiting-list/${entry.body.entry._id}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot } }
    );

    assert.equal(assigned.status, 201, JSON.stringify(assigned.body));

    // An ORDINARY appointment - no second system, no special flag.
    const appointment = await Appointment.findById(
      assigned.body.appointment._id
    );
    assert.equal(appointment.slot, slot);
    assert.equal(appointment.status, "Waiting");
    assert.ok(appointment.tokenNumber, "with a token, like any booking");
    assert.equal(String(appointment.doctorId), String(doctor._id));
    assert.equal(String(appointment.patient), String(patients[0]._id));

    // The reservation for that one slot is released; the rest of the window
    // stays held.
    assert.equal(
      await BlockedSlot.countDocuments({
        doctorId: doctor._id,
        date: today(),
        slot,
        isRecovery: true,
      }),
      0
    );
    assert.equal(
      await BlockedSlot.countDocuments({
        doctorId: doctor._id,
        date: today(),
        isRecovery: true,
      }),
      plan.windowSlots.length - 1,
      "the rest of the window is still protected"
    );

    // The normal appointment is exactly as it was.
    const untouched = await Appointment.findById(normal._id);
    assert.equal(untouched.slot, plan.protectedSlots[0]);
    assert.equal(untouched.tokenNumber, 7500);
    assert.equal(untouched.status, "Waiting");
  });

  test("a recovery slot cannot be double booked", async () => {
    const plan = await windowOverLastSlots(2);

    if (!plan) {
      console.log("      SKIPPED: not enough free slots left today");
      return;
    }

    await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), start: plan.start, end: plan.end },
    });

    const slot = plan.windowSlots[0];
    const first = await addWalkIn(patients[0]);
    const second = await addWalkIn(patients[1]);

    const won = await req(
      `/receptionist/waiting-list/${first.body.entry._id}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot } }
    );
    assert.equal(won.status, 201);

    const lost = await req(
      `/receptionist/waiting-list/${second.body.entry._id}/assign`,
      { method: "POST", token: asReceptionist(), body: { slot } }
    );
    assert.equal(lost.status, 409);

    assert.equal(
      await Appointment.countDocuments({
        doctorId: doctor._id,
        appointmentDate: today(),
        slot,
        slotActive: true,
      }),
      1
    );
  });

  test("a window cannot take back capacity a patient already holds", async () => {
    const plan = await windowOverLastSlots(2);

    if (!plan) {
      console.log("      SKIPPED: not enough free slots left today");
      return;
    }

    // Someone books inside the window BEFORE it is opened.
    const inside = plan.windowSlots[0];

    await Appointment.create({
      patient: patients[1]._id,
      patientName: patients[1].name,
      phone: patients[1].phone,
      age: 44,
      gender: "Female",
      doctorId: doctor._id,
      appointmentDate: today(),
      slot: inside,
      symptoms: "automated test",
      status: "Waiting",
      tokenNumber: 7600,
    });

    const opened = await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), start: plan.start, end: plan.end },
    });

    assert.equal(opened.status, 201);
    assert.ok(
      !opened.body.recoverySlots.includes(inside),
      "a slot someone already booked is not swallowed by the window"
    );

    // Their appointment is untouched.
    const stored = await Appointment.findOne({
      doctorId: doctor._id,
      appointmentDate: today(),
      slot: inside,
    });
    assert.equal(stored.tokenNumber, 7600);
    assert.equal(stored.status, "Waiting");
  });

  test("closing the window returns what is left to ordinary booking", async () => {
    const plan = await windowOverLastSlots(2);

    if (!plan) {
      console.log("      SKIPPED: not enough free slots left today");
      return;
    }

    await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id), start: plan.start, end: plan.end },
    });

    const closed = await req(
      `/receptionist/recovery-window?doctorId=${doctor._id}`,
      { method: "DELETE", token: asReceptionist() }
    );

    assert.equal(closed.status, 200);
    assert.deepEqual(closed.body.released.sort(), [...plan.windowSlots].sort());

    // Back in the ordinary pool, exactly as before it was opened.
    const after = await freeSlots();
    for (const slot of plan.windowSlots) {
      assert.ok(after.includes(slot), `${slot} is bookable again`);
    }

    assert.equal(
      await BlockedSlot.countDocuments({
        doctorId: doctor._id,
        date: today(),
        isRecovery: true,
      }),
      0
    );

    // Closing again says so rather than pretending.
    const again = await req(
      `/receptionist/recovery-window?doctorId=${doctor._id}`,
      { method: "DELETE", token: asReceptionist() }
    );
    assert.equal(again.status, 404);
  });

  test("bad windows are refused", async () => {
    const noTimes = await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: { doctorId: String(doctor._id) },
    });
    assert.equal(noTimes.status, 400);

    const backwards = await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: {
        doctorId: String(doctor._id),
        start: "01:00 PM",
        end: "12:00 PM",
      },
    });
    assert.equal(backwards.status, 400);

    // A window over a period with nothing free left.
    const empty = await req("/receptionist/recovery-window", {
      method: "POST",
      token: asReceptionist(),
      body: {
        doctorId: String(doctor._id),
        start: "03:00 AM",
        end: "04:00 AM",
      },
    });
    assert.equal(empty.status, 409);

    assert.equal(
      await BlockedSlot.countDocuments({
        doctorId: doctor._id,
        date: today(),
        isRecovery: true,
      }),
      0,
      "nothing refused may have held anything"
    );
  });

  test("only reception can open or close a recovery window", async () => {
    for (const [method, pathname, body] of [
      [
        "POST",
        "/receptionist/recovery-window",
        { doctorId: String(doctor._id), start: "12:00 PM", end: "01:00 PM" },
      ],
      ["DELETE", `/receptionist/recovery-window?doctorId=${doctor._id}`, undefined],
    ]) {
      const asOtherRole = await req(pathname, { method, token: asDoctor(), body });
      assert.equal(asOtherRole.status, 403, `${method} ${pathname}`);

      const anonymous = await req(pathname, { method, body });
      assert.equal(anonymous.status, 401, `${method} ${pathname} (anonymous)`);
    }

    assert.equal(
      await BlockedSlot.countDocuments({
        doctorId: doctor._id,
        date: today(),
        isRecovery: true,
      }),
      0
    );
  });
});
