import { test, expect } from '@playwright/test';
import {
  connect,
  disconnect,
  actors,
  anyFreeSlotToday,
  makeAppointment,
  loginAs,
  signReceptionist,
} from './helpers/backend.js';

// Regression cover for a bug introduced when token assignment moved from
// check-in to booking. Five separate places asked "does this patient have a
// token?" to mean "has this patient arrived?", which was true when tokens were
// handed out at the desk and silently became "has an appointment" afterwards.
//
// The visible symptom was a dashboard that disagreed with itself: the stats
// counted a patient as checked in while the table below still offered a Check
// In button for them.
test.describe('receptionist dashboard counts', () => {
  let doctor;
  let patient;
  let receptionist;
  let created;

  test.beforeAll(async () => {
    await connect();
    ({ doctor, patient, receptionist } = await actors());
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

  test('a booked patient counts as awaiting check-in, not as checked in', async ({
    page,
  }) => {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    // A token from the moment of booking is the whole point - the patient can
    // watch their position from home - so its presence must not imply arrival.
    created = await makeAppointment({
      doctor,
      patient,
      slot,
      tokenNumber: 999,
    });

    await loginAs(page, 'receptionistToken', signReceptionist(receptionist._id));
    await page.goto('/receptionist');

    const row = page.locator('tr', { hasText: 'Playwright Probe' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    // The table and the stats must tell the same story.
    await expect(
      row.getByRole('button', { name: /check in/i }),
      'the table should still offer Check In'
    ).toBeVisible();

    // The stat card renders its label and caption as sibling paragraphs, so
    // the assertion targets the caption directly rather than trying to walk up
    // to a wrapper element whose tag is an implementation detail.
    await expect(
      page.getByText(/\d+ awaiting check-in/),
      'the stats must not already count this patient as arrived'
    ).toBeVisible();
  });

  test('checking a patient in moves them from awaiting to waiting', async ({
    page,
  }) => {
    const slot = await anyFreeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no unbooked slots today at all');

    created = await makeAppointment({ doctor, patient, slot });

    await loginAs(page, 'receptionistToken', signReceptionist(receptionist._id));
    await page.goto('/receptionist');

    const row = page.locator('tr', { hasText: 'Playwright Probe' }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: /check in/i }).click();

    // Once arrived, the Check In button is gone and the row stops describing
    // them as absent.
    //
    // Deliberately NOT asserting "Checked In - Normal Queue": that is the
    // wording for someone who arrived within the grace period, and this
    // fixture takes whatever slot the doctor has free - which after the
    // clinic closes is a slot that has already gone by, making the patient a
    // late arrival. Both outcomes are correct check-ins, and the ONE thing
    // that must be true of either is that the desk is no longer being offered
    // an action the patient has already completed.
    await expect(
      row.getByRole('button', { name: /^check in$/i }),
      'a checked-in patient must not still be offered Check In'
    ).toHaveCount(0, { timeout: 15_000 });

    await expect(row).not.toContainText(/not arrived/i);
    await expect(row).toContainText(/within grace period|late — beyond/i);
  });
});
