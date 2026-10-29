import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.join(HERE, '..', '..', '..', 'backend');

// The backend is CommonJS and this package is ESM, so its modules are pulled in
// through createRequire. They are loaded from the backend itself rather than
// redeclared here: a fixture that redefines a schema drifts from the real one
// and starts writing documents the app would reject, without ever failing.
const require = createRequire(path.join(BACKEND, 'package.json'));

const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(BACKEND, '.env') });

export const Appointment = require('./models/Appointment');
export const Doctor = require('./models/Doctor');
export const Patient = require('./models/Patient');
export const Receptionist = require('./models/Receptionist');
export const Nurse = require('./models/Nurse');
export const LabTechnician = require('./models/LabTechnician');
export const Prescription = require('./models/Prescription');
export const LabResult = require('./models/LabResult');
export const LabTest = require('./models/LabTest');
export const Hospital = require('./models/Hospital');
export const LabOrder = require('./models/LabOrder');

const { normalizeToIstDay } = require('./utils/istDay');
const { getDoctorDaySlots } = require('./utils/doctorAvailability');

export { normalizeToIstDay };

export const API = 'http://localhost:5000';

export async function connect() {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGO_URI);
  }
}

export async function disconnect() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

function secret() {
  if (!process.env.JWT_SECRET) {
    throw new Error(
      'JWT_SECRET is not set - these tests read backend/.env, which is not committed.'
    );
  }
  return process.env.JWT_SECRET;
}

// Tests sign their own tokens rather than driving the login forms. Logging in
// through the UI would mean putting working staff passwords in the repo, and
// would make every test depend on the login page - one broken login would fail
// the whole suite instead of just its own test. Login has its own test.
export const signDoctor = (id) =>
  jwt.sign({ doctorId: String(id), role: 'doctor' }, secret(), {
    expiresIn: '1h',
  });

export const signReceptionist = (id) =>
  jwt.sign({ receptionistId: String(id), role: 'receptionist' }, secret(), {
    expiresIn: '1h',
  });

export const signNurse = (id) =>
  jwt.sign({ nurseId: String(id), role: 'nurse' }, secret(), {
    expiresIn: '1h',
  });

export const signLabTechnician = (id) =>
  jwt.sign({ labTechnicianId: String(id), role: 'labTechnician' }, secret(), {
    expiresIn: '1h',
  });

export const signPatient = (id) =>
  jwt.sign({ patientId: String(id), role: 'patient' }, secret(), {
    expiresIn: '1h',
  });

/**
 * Seeds a token into localStorage before the app loads. Must be an init script:
 * the route guards read localStorage on first render, so a token written after
 * navigation arrives too late and the guard has already redirected to login.
 */
export async function loginAs(page, key, token) {
  await page.addInitScript(
    ([k, t]) => window.localStorage.setItem(k, t),
    [key, token]
  );
}

export async function api(pathname, { method = 'GET', token, body } = {}) {
  const res = await fetch(API + pathname, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: 'Bearer ' + token } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return { status: res.status, body: await res.json().catch(() => ({})) };
}

// The app's calendar day is IST. `new Date().toISOString().slice(0, 10)` is
// the UTC date, which between midnight and 05:30 IST is still yesterday - a
// test using it asks for a past date and gets a 400. This is the same trap the
// production slot bug came from, so tests must not reintroduce it.
export function istDateString(date = new Date()) {
  return new Date(normalizeToIstDay(date).getTime() + 5.5 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
}

export async function actors() {
  const doctor = await Doctor.findOne({ isAvailable: true });
  const patient = await Patient.findOne({
    phone: { $exists: true, $nin: [null, ''] },
  });
  const receptionist = await Receptionist.findOne();

  if (!doctor || !patient || !receptionist) {
    throw new Error(
      'The database has no available doctor, patient with a phone, or receptionist to test with.'
    );
  }

  return { doctor, patient, receptionist };
}

// The nurse role is newer than the seeded staff data, so the fixture creates
// its own rather than requiring one to exist. Returns a cleanup that removes
// it again - unlike the doctor/patient/receptionist actors, this one is not
// real hospital data and must not be left behind.
const TEST_NURSE_EMAIL = 'playwright.nurse@example.invalid';

export async function testNurse() {
  const nurse = await Nurse.findOneAndUpdate(
    { email: TEST_NURSE_EMAIL },
    {
      $setOnInsert: {
        name: 'Playwright Nurse',
        email: TEST_NURSE_EMAIL,
        // Never used: the tests sign their own tokens rather than logging in.
        password: 'not-a-usable-login',
      },
    },
    { upsert: true, new: true }
  );

  return {
    nurse,
    cleanup: () => Nurse.deleteOne({ email: TEST_NURSE_EMAIL }),
  };
}

const TEST_TECH_EMAIL = 'playwright.tech@example.invalid';

// Same reasoning as testNurse(): the role is newer than the seeded staff data,
// so the fixture creates and removes its own.
export async function testLabTechnician() {
  const labTechnician = await LabTechnician.findOneAndUpdate(
    { email: TEST_TECH_EMAIL },
    {
      $setOnInsert: {
        name: 'Playwright Technician',
        email: TEST_TECH_EMAIL,
        // Never used: the tests sign their own tokens rather than logging in.
        password: 'not-a-usable-login',
      },
    },
    { upsert: true, new: true }
  );

  return {
    labTechnician,
    cleanup: () => LabTechnician.deleteOne({ email: TEST_TECH_EMAIL }),
  };
}

// These tests run against the same database the app uses, which already holds
// real bookings. Taking a slot the doctor genuinely has free avoids colliding
// with one of them; a hard-coded time would pass or fail depending on the day.
export async function freeSlotToday(doctor) {
  const { slots } = await getDoctorDaySlots(doctor, new Date());
  return slots.length ? slots[slots.length - 1] : null;
}

/**
 * Creates a today appointment, returning it with a cleanup that also removes
 * anything written against it during the test.
 */
export async function makeAppointment({ doctor, patient, slot, ...rest }) {
  const appointment = await Appointment.create({
    patient: patient._id,
    patientName: 'Playwright Probe',
    phone: patient.phone,
    age: 35,
    gender: 'Male',
    doctorId: doctor._id,
    appointmentDate: normalizeToIstDay(new Date()),
    slot,
    symptoms: 'automated test',
    status: 'Waiting',
    ...rest,
  });

  const cleanup = async () => {
    await Prescription.deleteMany({ appointmentId: appointment._id });
    await LabResult.deleteMany({ appointmentId: appointment._id });
    await LabOrder.deleteMany({ appointmentId: appointment._id });
    await LabResult.deleteMany({ appointmentId: appointment._id });
    await Appointment.deleteOne({ _id: appointment._id });
  };

  return { appointment, cleanup };
}

// ---------------------------------------------------------------------------
// Lateness fixtures
//
// freeSlotToday() only ever returns a FUTURE slot, because that is what
// booking needs. The receptionist's late/waiting-list decision is the exact
// opposite case: it only exists for a slot that has already gone by. After
// the clinic closes there are no future slots at all, which is why the
// booking-driven specs skip in the evening - but past slots are plentiful,
// so these fixtures let the lateness rules be tested at any hour.
// ---------------------------------------------------------------------------

const generateSlots = require('./utils/generateSlots');
const getISTDayRange = require('./utils/getISTDayRange');
const { slotToMinutes } = require('./utils/queueOrder');
export const BlockedSlot = require('./models/BlockedSlot');
export const WaitingListEntry = require('./models/WaitingListEntry');

/** The real instant a slot label falls on, on the given day. */
export function slotInstant(slot, date = new Date()) {
  const { todayStart } = getISTDayRange(date);
  return new Date(todayStart.getTime() + slotToMinutes(slot) * 60 * 1000);
}

/**
 * Slots today that have already passed and that nobody holds.
 *
 * Booked and blocked slots are excluded the same way getDoctorDaySlots does,
 * so a fixture can never collide with a real booking sitting in the shared
 * database.
 */
export async function pastFreeSlotsToday(doctor, count = 1) {
  if (!doctor.workingHours?.start || !doctor.workingHours?.end) return [];

  const { todayStart, todayEnd } = getISTDayRange(new Date());

  const [booked, blocked] = await Promise.all([
    Appointment.find({
      doctorId: doctor._id,
      appointmentDate: { $gte: todayStart, $lte: todayEnd },
      status: { $ne: 'Cancelled' },
    }).select('slot'),
    BlockedSlot.find({
      doctorId: doctor._id,
      date: { $gte: todayStart, $lte: todayEnd },
    }).select('slot'),
  ]);

  const taken = new Set([
    ...booked.map((a) => a.slot),
    ...blocked.map((b) => b.slot),
  ]);

  // Comfortably past, not merely past.
  //
  // Taking the most recent past slot made the fixtures flaky during clinic
  // hours: at 11:22 the latest past slot is 11:20, which is two minutes ago -
  // INSIDE the five-minute grace period, so a patient there is correctly not
  // late and the overdue tests failed against behaviour that was right. The
  // margin has to clear the grace window with room for the test to run.
  const GRACE_MARGIN_MINUTES = 20;
  const cutoff = Date.now() - GRACE_MARGIN_MINUTES * 60 * 1000;

  return generateSlots(
    doctor.workingHours.start,
    doctor.workingHours.end,
    doctor.slotDuration
  )
    .filter((slot) => !taken.has(slot))
    .filter((slot) => slotInstant(slot).getTime() < cutoff)
    // Latest first: the most recent qualifying slots are the least likely to
    // be reused by another suite running against the same doctor.
    .reverse()
    .slice(0, count);
}

/**
 * An appointment at a past slot, checked in `minutesAfterSlot` minutes after
 * that slot - i.e. exactly the lateness the receptionist has to judge.
 * Pass null to leave them not-arrived (the overdue case).
 */
export async function makeLateAppointment({
  doctor,
  patient,
  slot,
  minutesAfterSlot,
  ...rest
}) {
  const checkedInAt =
    minutesAfterSlot === null
      ? null
      : new Date(slotInstant(slot).getTime() + minutesAfterSlot * 60 * 1000);

  return makeAppointment({ doctor, patient, slot, checkedInAt, ...rest });
}

// A throwaway patient of this suite's own.
//
// The lateness fixtures cannot borrow a real patient the way actors() does:
// the waiting list refuses the same patient twice for one doctor, correctly,
// and the shared database already holds real people sitting on real lists. A
// borrowed patient therefore made the move fixture fail for a reason that had
// nothing to do with the code under test.
//
// The phone uses the 999000 prefix that scripts/cleanTestResidue.js treats as
// reserved, so a crashed run leaves something recognisable and removable.
const TEST_PATIENT_PHONE = '9990000111';

export async function testPatient() {
  const record = await Patient.findOneAndUpdate(
    { phone: TEST_PATIENT_PHONE },
    {
      $setOnInsert: {
        name: 'Playwright Patient',
        phone: TEST_PATIENT_PHONE,
        email: 'playwright.patient@example.invalid',
        // Never used: the tests sign their own tokens rather than logging in.
        password: 'not-a-usable-login',
      },
    },
    { upsert: true, new: true }
  );

  return {
    patient: record,
    cleanup: async () => {
      await WaitingListEntry.deleteMany({ patient: record._id });
      await Appointment.deleteMany({ patient: record._id });
      await Patient.deleteOne({ _id: record._id });
    },
  };
}

/**
 * A free slot today, future if the clinic is still open and past if it is not.
 *
 * freeSlotToday() returns only future slots, because booking needs one. Tests
 * that merely need an appointment to EXIST - a consultation screen, a vitals
 * panel - do not care whether its slot has gone by, and skipping them every
 * evening meant the suite was quietest exactly when it was run most.
 */
export async function anyFreeSlotToday(doctor) {
  const upcoming = await freeSlotToday(doctor);
  if (upcoming) return upcoming;

  const [past] = await pastFreeSlotsToday(doctor, 1);
  return past || null;
}
