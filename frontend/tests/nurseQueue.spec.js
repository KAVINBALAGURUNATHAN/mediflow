import { test, expect } from '@playwright/test';
import {
  connect,
  disconnect,
  actors,
  testNurse,
  testPatient,
  pastFreeSlotsToday,
  makeAppointment,
  loginAs,
  signNurse,
  signReceptionist,
  Appointment,
  API,
} from './helpers/backend.js';

// The receptionist -> nurse hand-off, in a real browser.
//
// The backend half of this is covered by tests/nurseQueue.test.js. What can
// only be shown here is the part the reported symptom was actually about: the
// nurse is looking at the screen when reception checks somebody in, and the
// patient has to turn up WITHOUT the nurse reloading anything. A correct API
// that the page never re-reads looks exactly like a broken API from the desk.
test.describe('nurse queue', () => {
  let doctor;
  let receptionist;
  let patient;
  let patientCleanup;
  let nurse;
  let nurseCleanup;
  let slots;
  const created = [];

  test.beforeAll(async () => {
    await connect();
    ({ doctor, receptionist } = await actors());
    ({ nurse, cleanup: nurseCleanup } = await testNurse());
    ({ patient, cleanup: patientCleanup } = await testPatient());
    slots = await pastFreeSlotsToday(doctor, 4);
  });

  test.afterEach(async () => {
    while (created.length) {
      await created.pop().cleanup();
    }
  });

  test.afterAll(async () => {
    if (nurseCleanup) await nurseCleanup();
    if (patientCleanup) await patientCleanup();
    await disconnect();
  });

  async function book({ name, index = 0, ...rest }) {
    const slot = slots[index];
    test.skip(!slot, 'the doctor has no unbooked past slots today');

    const made = await makeAppointment({
      doctor,
      patient,
      slot,
      patientName: name,
      tokenNumber: 7500 + Math.floor(Math.random() * 400),
      ...rest,
    });

    created.push(made);
    return made.appointment;
  }

  const openNurse = async (page) => {
    await loginAs(page, 'nurseToken', signNurse(nurse._id));
    await page.goto('/nurse');
  };

  // THE REPORTED BUG. The nurse never touches the page.
  test('a patient checked in by reception appears without a reload', async ({
    page,
    request,
  }) => {
    const appointment = await book({ name: 'Live Refresh Probe' });

    await openNurse(page);

    // Booked but not arrived, so the nurse must not see them yet.
    await expect(
      page.getByRole('heading', { name: /patients awaiting vitals/i })
    ).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Live Refresh Probe')).toHaveCount(0);

    // Reception checks them in from somewhere else entirely.
    const res = await request.patch(
      `${API}/receptionist/appointments/${appointment._id}/check-in`,
      {
        headers: {
          Authorization: `Bearer ${signReceptionist(receptionist._id)}`,
        },
        data: { priority: 'Normal' },
        failOnStatusCode: false,
      }
    );
    expect(res.status(), await res.text()).toBe(200);

    // No reload, no refresh click: the queueUpdated broadcast has to carry it.
    await expect(
      page.getByText('Live Refresh Probe'),
      'the nurse must not have to reload to see a newly arrived patient'
    ).toBeVisible({ timeout: 20_000 });
  });

  // An empty queue must read as empty, never as demo data. A page that falls
  // back to placeholder patients hides exactly the failure this suite exists
  // to catch.
  test('an empty queue shows a real empty state, not placeholder patients', async ({
    page,
  }) => {
    await openNurse(page);

    await expect(
      page.getByRole('heading', { name: /patients awaiting vitals/i })
    ).toBeVisible({ timeout: 15_000 });

    const awaiting = await Appointment.countDocuments({
      checkedInAt: { $ne: null },
      status: { $in: ['Waiting', 'In Consultation'] },
      readyForDoctorAt: null,
      appointmentDate: {
        $gte: new Date(new Date().setHours(0, 0, 0, 0) - 12 * 3600 * 1000),
      },
    });

    if (awaiting === 0) {
      await expect(page.getByText(/no patients awaiting vitals/i)).toBeVisible();
    }

    // Whatever the queue holds, it is never these. The fixture names used by
    // this repo's own suites must not be reachable from a clean demo screen -
    // if one shows up here it is residue from a crashed run, not a patient.
    for (const name of [
      'Waiting Probe',
      'Queue Probe',
      'Vitals Probe',
      'Playwright Probe',
    ]) {
      await expect(
        page.getByText(name, { exact: false }),
        `${name} is test residue and must never appear in the demo UI`
      ).toHaveCount(0);
    }
  });

  // The full clinical hand-off, driven through the nurse's own screen.
  test('the nurse records vitals and hands the patient to the doctor', async ({
    page,
  }) => {
    const appointment = await book({
      name: 'Handover Probe',
      checkedInAt: new Date(),
    });

    await openNurse(page);

    // Scoped to this patient's own card. The shared database has other real
    // patients checked in, so an unscoped button locator matches theirs too.
    const card = page
      .locator('div.rounded-2xl.border')
      .filter({ hasText: 'Handover Probe' })
      .first();
    await expect(card).toBeVisible({ timeout: 15_000 });
    const row = card;

    // The appointment time has to be readable - it is how the nurse knows
    // who is next.
    await expect(row).toContainText(appointment.slot);

    // "Record" for a patient with nothing measured yet; the same form
    // becomes "Correct" once there is something to change.
    await card.getByRole('button', { name: /^record$/i }).click();

    await card.getByLabel('Height').fill('165');
    await card.getByLabel('Weight').fill('60');
    await card.getByLabel('Respiratory rate').fill('15');

    await card.getByRole('button', { name: /save vitals/i }).click();

    await expect
      .poll(
        async () => {
          const stored = await Appointment.findById(appointment._id).lean();
          return stored?.vitals?.bmi ?? null;
        },
        { timeout: 15_000, message: 'BMI should be derived and stored' }
      )
      .toBe(22);

    await card.getByRole('button', { name: /^ready for doctor$/i }).click();

    await expect
      .poll(
        async () => {
          const stored = await Appointment.findById(appointment._id).lean();
          return Boolean(stored?.readyForDoctorAt);
        },
        { timeout: 15_000, message: 'the hand-off should be stamped' }
      )
      .toBe(true);
  });
});
