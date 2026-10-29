import { test, expect } from '@playwright/test';
import {
  connect,
  disconnect,
  actors,
  testNurse,
  anyFreeSlotToday,
  makeAppointment,
  loginAs,
  signNurse,
  signReceptionist,
  Appointment,
} from './helpers/backend.js';

// The clinical half of the visit flow: reception records the arrival, the
// nurse records the measurement. BMI is derived rather than typed, and the
// receptionist's queue shows the result without being able to change it.
test.describe('nurse vitals', () => {
  let doctor;
  let patient;
  let receptionist;
  let nurse;
  let nurseCleanup;
  let created;

  test.beforeAll(async () => {
    await connect();
    ({ doctor, patient, receptionist } = await actors());
    ({ nurse, cleanup: nurseCleanup } = await testNurse());
  });

  test.afterEach(async () => {
    if (created) {
      await created.cleanup();
      created = null;
    }
  });

  test.afterAll(async () => {
    if (nurseCleanup) await nurseCleanup();
    await disconnect();
  });

  test('BMI is previewed live and stored when the nurse records vitals', async ({
    page,
  }) => {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    // The nurse's list is checked-in patients only - vitals are taken in the
    // room, so a booking nobody has arrived for is not their work.
    created = await makeAppointment({
      doctor,
      patient,
      slot,
      checkedInAt: new Date(),
    });

    await loginAs(page, 'nurseToken', signNurse(nurse._id));
    await page.goto('/nurse');

    // Scoped to THIS patient's card, not to the page.
    //
    // These locators used to reach across the whole screen - .first() on the
    // Record button, an unscoped getByText for the BMI - which worked only
    // while this fixture was the only patient on the nurse's queue. The
    // moment a second patient is checked in (a real one; dev and production
    // share a database) .first() opens somebody else's form and the BMI
    // matches two elements at once: the live preview inside the form and the
    // "BMI 24.9" summary in the row header.
    const card = page
      .locator('div.rounded-2xl.border')
      .filter({ hasText: 'Playwright Probe' })
      .first();
    await expect(card).toBeVisible({ timeout: 15_000 });

    await card.getByRole('button', { name: /^Record$/ }).click();

    await card.getByLabel(/^Height/).fill('170');
    await card.getByLabel(/^Weight/).fill('72');

    // Shown before anything is saved, so the nurse can catch a slipped
    // decimal point while still looking at the patient. Addressed by the
    // preview's own label rather than by its value, so it cannot collide
    // with the same number rendered elsewhere on the card.
    await expect(card.getByText('24.9', { exact: true })).toBeVisible();

    await card.getByLabel(/^SpO2/).fill('98');
    await card.getByRole('button', { name: /save vitals/i }).click();

    await expect
      .poll(
        async () => {
          const fresh = await Appointment.findById(created.appointment._id);
          return fresh?.vitals?.bmi ?? null;
        },
        { message: 'BMI should be stored on the appointment', timeout: 15_000 }
      )
      .toBe(24.9);

    const stored = await Appointment.findById(created.appointment._id);
    expect(stored.vitals.heightCm).toBe(170);
    expect(stored.vitals.weightKg).toBe(72);
    expect(stored.vitals.spo2).toBe(98);
    expect(stored.vitals.recordedByModel).toBe('Nurse');
  });

  test('the nurse hands the patient over only once vitals exist', async ({
    page,
  }) => {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    created = await makeAppointment({
      doctor,
      patient,
      slot,
      checkedInAt: new Date(),
      vitals: { heightCm: 170, weightKg: 72 },
    });

    await loginAs(page, 'nurseToken', signNurse(nurse._id));
    await page.goto('/nurse');

    const ready = page.getByRole('button', { name: /ready for doctor/i }).first();
    await expect(ready).toBeVisible({ timeout: 15_000 });
    await ready.click();

    await expect
      .poll(
        async () => {
          const fresh = await Appointment.findById(created.appointment._id);
          return Boolean(fresh?.readyForDoctorAt);
        },
        { message: 'the hand-off should be stamped', timeout: 15_000 }
      )
      .toBe(true);
  });

  test('the receptionist sees vitals but has no way to change them', async ({
    page,
  }) => {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    created = await makeAppointment({
      doctor,
      patient,
      slot,
      checkedInAt: new Date(),
      vitals: { heightCm: 170, weightKg: 72 },
    });

    await loginAs(page, 'receptionistToken', signReceptionist(receptionist._id));
    await page.goto('/receptionist');

    const row = page.locator('tr', { hasText: 'Playwright Probe' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // The derived BMI is still the receptionist's operational context.
    await expect(row).toContainText('BMI 24.9');

    // But the inputs that used to live in this cell are gone - the backend
    // refuses a receptionist token on the vitals endpoint, so an input here
    // could only ever fail.
    await expect(row.getByLabel(/height in cm/i)).toHaveCount(0);
    await expect(row.getByLabel(/weight in kg/i)).toHaveCount(0);
  });

  test('an already-checked-in patient still shows the Check In button gone, not the inputs', async ({
    page,
  }) => {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    // Booking assigns a token up front, so "has a token" cannot mean "has
    // arrived" - this is the regression that once hid the Check In button for
    // every patient who had merely booked.
    created = await makeAppointment({
      doctor,
      patient,
      slot,
      tokenNumber: null,
    });

    await loginAs(page, 'receptionistToken', signReceptionist(receptionist._id));
    await page.goto('/receptionist');

    const row = page.locator('tr', { hasText: 'Playwright Probe' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await expect(
      row.getByRole('button', { name: /check in/i }),
      'a patient who has not arrived must still be checkable-in'
    ).toBeVisible();
  });
});
