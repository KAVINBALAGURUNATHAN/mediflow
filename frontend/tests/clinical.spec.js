import { test, expect } from '@playwright/test';
import {
  connect,
  disconnect,
  actors,
  anyFreeSlotToday,
  makeAppointment,
  loginAs,
  signDoctor,
  Prescription,
  LabResult,
  LabTest,
  LabOrder,
} from './helpers/backend.js';

// The doctor's half of the visit: read the vitals the nurse recorded, then
// prescribe and order tests. Both write to their own collections, which is
// what makes the patient's Prescriptions and Lab Results pages fill up - they
// were unreachable from the UI before and so were always empty.
test.describe('consultation screen', () => {
  let doctor;
  let patient;
  let created;

  test.beforeAll(async () => {
    await connect();
    ({ doctor, patient } = await actors());
  });

  test.afterEach(async () => {
    if (created) {
      await created.cleanup();
      created = null;
    }
  });

  test.afterAll(async () => {
    await disconnect();
  });

  async function openConsultation(page, extra = {}) {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    created = await makeAppointment({ doctor, patient, slot, ...extra });

    await loginAs(page, 'doctorToken', signDoctor(doctor._id));
    await page.goto(`/appointments/${created.appointment._id}`);

    return created.appointment;
  }

  // Same, but runs a seeding step against the fresh appointment BEFORE the
  // page loads - a record created after navigation arrives too late for the
  // consultation screen's single records fetch.
  async function openConsultationWith(page, seed) {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    created = await makeAppointment({ doctor, patient, slot });
    await seed(created);

    await loginAs(page, 'doctorToken', signDoctor(doctor._id));
    await page.goto(`/appointments/${created.appointment._id}`);

    return created.appointment;
  }

  test('vitals recorded by the nurse are shown to the doctor', async ({
    page,
  }) => {
    await openConsultation(page, {
      vitals: { heightCm: 170, weightKg: 72 },
      checkedInAt: new Date(),
    });

    // Addressed by the panel's own accessible name rather than by walking up
    // from the heading: the heading now shares a row with the "Ready for
    // doctor" badge, so its parent is that row, not the panel.
    const vitals = page.getByRole('group', { name: 'Vitals' });
    await expect(vitals).toContainText('170 cm', { timeout: 15_000 });
    await expect(vitals).toContainText('72 kg');
    await expect(vitals, 'BMI should be derived, not blank').toContainText(
      '24.9'
    );
  });

  // The regression that hid a full set of observations from the doctor.
  //
  // Height and weight are the one PAIR the nurse must take together, so a
  // patient who is examined but not weighed has no BMI - and the doctor's
  // panel used to be gated on BMI, which meant blood pressure, temperature,
  // pulse, SpO2 and respiratory rate were all recorded, stored, returned by
  // the API, and then rendered as "Not recorded by the nurse yet."
  test('vitals with no BMI are still shown to the doctor', async ({ page }) => {
    await openConsultation(page, {
      checkedInAt: new Date(),
      vitals: {
        bloodPressureSystolic: 138,
        bloodPressureDiastolic: 88,
        temperatureC: 38.4,
        pulseBpm: 104,
        spo2: 94,
        respiratoryRate: 22,
        recordedAt: new Date(),
        recordedByModel: 'Nurse',
      },
    });

    const vitals = page.getByRole('group', { name: 'Vitals' });

    await expect(vitals).toContainText('138/88 mmHg', { timeout: 15_000 });
    await expect(vitals).toContainText('38.4 °C');
    await expect(vitals).toContainText('104 bpm');
    await expect(vitals).toContainText('94 %');
    await expect(vitals).toContainText('22/min');

    // A measurement nobody took says so, rather than vanishing - the doctor
    // has to be able to tell "not measured" from "normal".
    await expect(vitals).toContainText('Not recorded');

    // And the panel must not read as though the doctor entered any of it.
    await expect(vitals).toContainText('Recorded by:');
    await expect(vitals).toContainText('Nurse');
  });

  test('a prescription written here reaches the database', async ({ page }) => {
    const appointment = await openConsultation(page);

    await expect(
      page.getByRole('heading', { name: 'Prescription' })
    ).toBeVisible({ timeout: 15_000 });

    await page.getByLabel('Medicine name').first().fill('Amoxicillin');
    await page.getByLabel('Dosage').first().fill('500 mg');
    await page.getByLabel('Frequency').first().fill('Twice a day');
    await page.getByLabel('Duration in days').first().fill('5');

    await page.getByRole('button', { name: /issue prescription/i }).click();

    await expect
      .poll(
        async () =>
          Prescription.countDocuments({ appointmentId: appointment._id }),
        { message: 'prescription should be stored', timeout: 15_000 }
      )
      .toBe(1);

    const stored = await Prescription.findOne({
      appointmentId: appointment._id,
    });
    expect(stored.medicines[0].name).toBe('Amoxicillin');
    expect(stored.medicines[0].durationDays).toBe(5);

    // It must also come back onto the page, not just into the database.
    await expect(page.getByText('Amoxicillin').first()).toBeVisible();
  });

  test('a lab test is ordered from the catalog, not typed', async ({ page }) => {
    const appointment = await openConsultation(page);

    await expect(page.getByRole('heading', { name: 'Lab tests' })).toBeVisible({
      timeout: 15_000,
    });

    // The doctor picks a definition. There is deliberately no free-text box
    // here any more - typing a name is what made "CBC" and "Complete Blood
    // Count" two different tests.
    await expect(page.getByLabel('Test name')).toHaveCount(0);

    const catalogTest = await LabTest.findOne({ name: 'Complete Blood Count' });
    expect(
      catalogTest,
      'the demo catalog must be seeded - run backend/scripts/seedLabTests.js'
    ).toBeTruthy();

    await page.getByLabel('Lab test').selectOption(String(catalogTest._id));

    // What the panel covers is shown before ordering, and comes from the
    // definition rather than from anything the doctor enters.
    await expect(page.getByText(/Haemoglobin/)).toBeVisible();

    await page.getByLabel('Note for the lab').fill('fasting sample');
    await page.getByRole('button', { name: /order lab test/i }).click();

    await expect
      .poll(
        async () => LabOrder.countDocuments({ appointmentId: appointment._id }),
        { message: 'lab order should be stored', timeout: 15_000 }
      )
      .toBe(1);

    const ordered = await LabOrder.findOne({ appointmentId: appointment._id });

    // An order is a link to a definition, not a copy of one.
    expect(String(ordered.labTestId)).toBe(String(catalogTest._id));
    expect(String(ordered.appointmentId)).toBe(String(appointment._id));
    expect(ordered.status).toBe('Ordered');
    expect(ordered.note).toBe('fasting sample');

    // And it comes back onto the page, not just into the database.
    await expect(page.getByText('Complete Blood Count').first()).toBeVisible();
    await expect(page.getByText('Ordered').first()).toBeVisible();
  });

  test('a lab-reported result is shown to the doctor, read-only', async ({
    page,
  }) => {
    const thyroid = await LabTest.findOne({ name: 'Thyroid Profile' });

    const appointment = await openConsultationWith(page, async (made) => {
      const order = await LabOrder.create({
        appointmentId: made.appointment._id,
        patientId: made.appointment.patient,
        doctorId: made.appointment.doctorId,
        labTestId: thyroid._id,
        status: 'Completed',
      });

      // What the laboratory reported (Phase 5 writes this shape).
      await LabResult.create({
        labOrderId: order._id,
        labTestId: thyroid._id,
        appointmentId: made.appointment._id,
        patientId: made.appointment.patient,
        doctorId: made.appointment.doctorId,
        testName: 'Thyroid Profile',
        status: 'Completed',
        summary: 'Slightly raised TSH',
        values: [
          {
            parameter: 'TSH',
            value: '5.9',
            unit: 'µIU/mL',
            referenceRange: '0.4 - 4.0',
            flag: 'High',
          },
        ],
      });
    });

    expect(appointment).toBeTruthy();

    // The reading, its unit, the range it was read against, and the flag.
    await expect(page.getByText('TSH:')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('5.9 µIU/mL')).toBeVisible();
    await expect(page.getByText('(ref 0.4 - 4.0)')).toBeVisible();
    await expect(page.getByText('Slightly raised TSH')).toBeVisible();

    // Read-only: the lab owns this record, so the doctor is not offered a way
    // to edit it. "Enter result" belongs only to legacy free-text orders.
    await expect(
      page.getByRole('button', { name: /enter result/i }),
      'a lab-reported result must not be editable from the consultation screen'
    ).toHaveCount(0);
  });

  test('an order placed by mistake can be withdrawn', async ({ page }) => {
    const appointment = await openConsultation(page);
    const catalogTest = await LabTest.findOne({ name: 'Thyroid Profile' });

    await expect(page.getByLabel('Lab test')).toBeVisible({ timeout: 15_000 });
    await page.getByLabel('Lab test').selectOption(String(catalogTest._id));
    await page.getByRole('button', { name: /order lab test/i }).click();

    await expect
      .poll(
        async () => LabOrder.countDocuments({ appointmentId: appointment._id }),
        { timeout: 15_000 }
      )
      .toBe(1);

    await page.getByRole('button', { name: /withdraw/i }).click();

    await expect
      .poll(
        async () => {
          const fresh = await LabOrder.findOne({
            appointmentId: appointment._id,
          });
          return fresh?.status;
        },
        { message: 'the order should be withdrawn', timeout: 15_000 }
      )
      .toBe('Cancelled');

    // Withdrawn, never deleted - that it was ordered and withdrawn is part of
    // the visit record.
    expect(
      await LabOrder.countDocuments({ appointmentId: appointment._id })
    ).toBe(1);
  });

  test('a legacy free-text result can still be filled in', async ({ page }) => {
    // Orders placed before the catalog existed are LabResult documents with a
    // typed testName. Nothing creates these any more, but the ones already in
    // the database must stay reportable rather than becoming unreachable.
    const appointment = await openConsultationWith(page, async (created) => {
      await LabResult.create({
        appointmentId: created.appointment._id,
        patientId: created.appointment.patient,
        doctorId: created.appointment.doctorId,
        testName: 'Legacy Panel',
        status: 'Ordered',
      });
    });

    await expect(page.getByText('Legacy Panel')).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: /enter result/i }).click();
    await page.getByLabel('Parameter').first().fill('Haemoglobin');
    await page.getByLabel('Value').first().fill('11.2');
    await page.getByLabel('Unit').first().fill('g/dL');
    await page.getByLabel('Flag').first().selectOption('Low');

    await page.getByRole('button', { name: /save as completed/i }).click();

    await expect
      .poll(
        async () => {
          const fresh = await LabResult.findOne({
            appointmentId: appointment._id,
          });
          return fresh?.status;
        },
        { message: 'result should be completed', timeout: 15_000 }
      )
      .toBe('Completed');

    const reported = await LabResult.findOne({ appointmentId: appointment._id });
    expect(reported.values[0].parameter).toBe('Haemoglobin');
    expect(reported.values[0].flag).toBe('Low');
    expect(
      reported.resultedAt,
      'completing a result must stamp when it was reported'
    ).toBeTruthy();
  });

  test('another doctor cannot open this consultation', async ({ page }) => {
    const appointment = await openConsultation(page);

    const { Doctor } = await import('./helpers/backend.js');
    const other = await Doctor.findOne({ _id: { $ne: doctor._id } });
    test.skip(!other, 'only one doctor in the database');

    await page.context().clearCookies();
    await loginAs(page, 'doctorToken', signDoctor(other._id));
    await page.goto(`/appointments/${appointment._id}`);

    // The page must not render this patient's record to a doctor who does not
    // own the appointment.
    await expect(page.locator('body')).not.toContainText('Playwright Probe', {
      timeout: 15_000,
    });
  });
});
