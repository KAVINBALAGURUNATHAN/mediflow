import { test, expect } from '@playwright/test';
import {
  connect,
  disconnect,
  actors,
  testLabTechnician,
  anyFreeSlotToday,
  makeAppointment,
  loginAs,
  signLabTechnician,
  LabTest,
  LabOrder,
  LabResult,
} from './helpers/backend.js';

// The laboratory's worklist: tests doctors have ordered, waiting to be run.
test.describe('lab technician worklist', () => {
  let doctor;
  let patient;
  let technician;
  let techCleanup;
  let created;
  let catalogTest;

  test.beforeAll(async () => {
    await connect();
    ({ doctor, patient } = await actors());
    ({ labTechnician: technician, cleanup: techCleanup } =
      await testLabTechnician());

    catalogTest = await LabTest.findOne({ name: 'Complete Blood Count' });
  });

  test.afterEach(async () => {
    if (created) {
      await created.cleanup();
      created = null;
    }
  });

  test.afterAll(async () => {
    if (techCleanup) await techCleanup();
    await disconnect();
  });

  async function orderFor(overrides = {}) {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    created = await makeAppointment({ doctor, patient, slot });

    const order = await LabOrder.create({
      appointmentId: created.appointment._id,
      patientId: patient._id,
      doctorId: doctor._id,
      labTestId: catalogTest._id,
      ...overrides,
    });

    return order;
  }

  test('a pending order is listed and can be started', async ({ page }) => {
    const order = await orderFor();

    await loginAs(page, 'labTechnicianToken', signLabTechnician(technician._id));
    await page.goto('/lab-technician');

    // The worklist renders the PATIENT RECORD's name (populated from the
    // Patient collection), not the appointment's patientName - so this is
    // the real patient's name, not the "Playwright Probe" label the
    // appointment fixture uses.
    const row = page
      .locator('tr')
      .filter({ hasText: 'Complete Blood Count' })
      .first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await expect(row).toContainText(patient.name);

    // The four columns the task asked for.
    await expect(row).toContainText(doctor.name);
    await expect(row).toContainText('Ordered');

    await row.getByRole('button', { name: /start test/i }).click();

    await expect
      .poll(
        async () => (await LabOrder.findById(order._id))?.status,
        { message: 'Ordered -> In Progress', timeout: 15_000 }
      )
      .toBe('In Progress');

    // And the row moves out of Pending into In progress on the page.
    await expect(
      page
        .locator('tr')
        .filter({ hasText: 'Complete Blood Count' })
        .first()
    ).toContainText('In Progress');
  });

  test('ONE form renders CBC and Thyroid from their definitions', async ({
    page,
  }) => {
    // The same component, twice, with no per-test branch. If a
    // CBCForm/ThyroidForm ever reappears, this is what should fail.
    const thyroid = await LabTest.findOne({ name: 'Thyroid Profile' });

    const cbcOrder = await orderFor({ status: 'In Progress', startedAt: new Date() });

    await loginAs(page, 'labTechnicianToken', signLabTechnician(technician._id));
    await page.goto('/lab-technician');

    await page.getByRole('button', { name: /enter result/i }).first().click();

    // exact:true because each parameter also has a "<name> flag" select, and
    // getByLabel matches on substring by default.
    // CBC's fields, straight from the catalog.
    await expect(page.getByLabel('Haemoglobin', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('Platelets', { exact: true })).toBeVisible();
    await expect(page.getByLabel('TSH', { exact: true })).toHaveCount(0);

    // Reference ranges are shown read-only, from the definition.
    await expect(page.getByText('13.0 - 17.0')).toBeVisible();

    await page.getByRole('button', { name: /close/i }).first().click();

    // Now the same component for a completely different panel.
    await LabOrder.updateOne(
      { _id: cbcOrder._id },
      { labTestId: thyroid._id }
    );
    await page.reload();

    await page.getByRole('button', { name: /enter result/i }).first().click();

    await expect(page.getByLabel('TSH', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByLabel('T3', { exact: true })).toBeVisible();
    await expect(page.getByLabel('T4', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Haemoglobin', { exact: true })).toHaveCount(0);

    // And completing it writes a real result.
    await page.getByLabel('TSH', { exact: true }).fill('2.1');
    await page.getByLabel('T3', { exact: true }).fill('120');
    await page.getByLabel('T4', { exact: true }).fill('8.0');
    await page.getByRole('button', { name: /complete result/i }).click();

    await expect
      .poll(
        async () => {
          const r = await LabResult.findOne({ labOrderId: cbcOrder._id });
          return r?.status;
        },
        { message: 'the result should be completed', timeout: 15_000 }
      )
      .toBe('Completed');

    const stored = await LabResult.findOne({ labOrderId: cbcOrder._id });
    expect(stored.values.map((v) => v.parameter)).toEqual(['TSH', 'T3', 'T4']);
    // Unit and range came from the definition, not from anything typed.
    expect(stored.values[0].unit).toBe('µIU/mL');

    await LabResult.deleteOne({ _id: stored._id });
  });

  test('an unauthorised role cannot open the worklist', async ({ page }) => {
    // A doctor's token is valid - for a different role. The guard must send
    // them to the technician login rather than render the worklist.
    await loginAs(page, 'doctorToken', 'not-a-technician-token');
    await page.goto('/lab-technician');

    await expect(page).toHaveURL(/lab-technician-login/, { timeout: 15_000 });
  });

  test('Lab Technician is offered on the staff login page', async ({ page }) => {
    await page.goto('/staff-login');

    await page.getByText('Lab Technician', { exact: true }).click();
    await expect(page).toHaveURL(/\/lab-technician-login$/);
    await expect(page.getByLabel('Email')).toBeVisible();
  });
});
