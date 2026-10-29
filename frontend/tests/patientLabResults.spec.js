import { test, expect } from '@playwright/test';
import {
  connect,
  disconnect,
  actors,
  anyFreeSlotToday,
  makeAppointment,
  loginAs,
  signPatient,
  LabTest,
  LabOrder,
  LabResult,
} from './helpers/backend.js';

// What the PATIENT sees of their own lab results.
//
// The backend half is covered by labResultVisibility.test.js. This covers the
// last link nothing else does: that the portal page actually renders a
// completed result, dynamically, for whatever test it happens to be - and
// shows no readings at all while the lab is still working.
test.describe('patient lab results', () => {
  let doctor;
  let patient;
  let created;
  let seeded = [];

  test.beforeAll(async () => {
    await connect();
    ({ doctor, patient } = await actors());
  });

  test.afterEach(async () => {
    for (const id of seeded) {
      await LabResult.deleteOne({ _id: id });
    }
    seeded = [];

    if (created) {
      await created.cleanup();
      created = null;
    }
  });

  test.afterAll(async () => {
    await disconnect();
  });

  // Builds a real order + result for `testName`, the same shape the lab
  // technician's form produces.
  async function reportedResult(testName, readings, { complete = true } = {}) {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    created = await makeAppointment({ doctor, patient, slot });

    const labTest = await LabTest.findOne({ name: testName });
    expect(labTest, `${testName} must be in the seeded catalog`).toBeTruthy();

    const order = await LabOrder.create({
      appointmentId: created.appointment._id,
      patientId: patient._id,
      doctorId: doctor._id,
      labTestId: labTest._id,
      status: complete ? 'Completed' : 'In Progress',
    });

    // Values carry the unit and range from the definition, exactly as
    // saveResult copies them.
    const values = labTest.parameters
      .filter((p) => readings[p.name] !== undefined)
      .map((p) => ({
        parameter: p.name,
        value: readings[p.name],
        unit: p.unit || '',
        referenceRange: p.referenceRange || '',
        flag: 'Normal',
      }));

    const result = await LabResult.create({
      labOrderId: order._id,
      labTestId: labTest._id,
      appointmentId: created.appointment._id,
      patientId: patient._id,
      doctorId: doctor._id,
      testName: labTest.name,
      status: complete ? 'Completed' : 'In Progress',
      values: complete ? values : [],
    });

    seeded.push(result._id);
    return { labTest, result };
  }

  async function openPortal(page) {
    await loginAs(page, 'patientToken', signPatient(patient._id));
    await page.addInitScript(
      (profile) => window.localStorage.setItem('patient', profile),
      JSON.stringify({
        _id: String(patient._id),
        name: patient.name,
        phone: patient.phone,
      })
    );
    await page.goto('/lab-results');
  }

  test('a completed Blood Glucose result is shown with its value and unit', async ({
    page,
  }) => {
    await reportedResult('Blood Glucose', { 'Fasting Blood Sugar': '95' });

    await openPortal(page);

    const card = page
      .locator('article')
      .filter({ hasText: 'Blood Glucose' })
      .first();

    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Completed');
    await expect(card).toContainText('Fasting Blood Sugar');
    await expect(card).toContainText('95');
    // The unit comes from the catalog definition, not from anything typed.
    await expect(card).toContainText('mg/dL');
  });

  test('the SAME page renders a completely different panel', async ({ page }) => {
    // Nothing here is specific to one test. If this ever needs its own
    // branch, the page has stopped being driven by the data.
    await reportedResult('Thyroid Profile', {
      TSH: '2.1',
      T3: '120',
      T4: '8.0',
    });

    await openPortal(page);

    const card = page
      .locator('article')
      .filter({ hasText: 'Thyroid Profile' })
      .first();

    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).toContainText('Completed');

    for (const parameter of ['TSH', 'T3', 'T4']) {
      await expect(card).toContainText(parameter);
    }

    await expect(card).toContainText('2.1');
    await expect(card).toContainText('µIU/mL');
    await expect(card).not.toContainText('Fasting Blood Sugar');
  });

  test('an unfinished result shows no readings at all', async ({ page }) => {
    // A half-entered panel must never be readable as a finished one. The
    // backend blanks the values (sanitizeLabResultForPatient); the page must
    // say so rather than rendering an empty list as "all clear".
    await reportedResult(
      'Blood Glucose',
      { 'Fasting Blood Sugar': '95' },
      { complete: false }
    );

    await openPortal(page);

    const card = page
      .locator('article')
      .filter({ hasText: 'Blood Glucose' })
      .first();

    await expect(card).toBeVisible({ timeout: 15_000 });
    await expect(card).not.toContainText('Completed');

    // The reading's LABEL, not its value. Asserting on "95" matched the
    // booking id printed on the same card - MF-1787595450783-3132 happens to
    // contain it, because the id is built from a timestamp - so this failed
    // roughly whenever the clock cooperated, against a page that was
    // behaving correctly. A parameter name cannot collide with an id.
    await expect(card).not.toContainText('Fasting Blood Sugar');
    await expect(card).toContainText(/not available yet/i);
  });
});
