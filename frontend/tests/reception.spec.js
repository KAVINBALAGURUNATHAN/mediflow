import { test, expect } from '@playwright/test';
import {
  connect,
  disconnect,
  actors,
  loginAs,
  signReceptionist,
  pastFreeSlotsToday,
  testPatient,
  makeLateAppointment,
  normalizeToIstDay,
  WaitingListEntry,
  Appointment,
  API,
} from './helpers/backend.js';

// The receptionist's late-patient decision, driven through the real UI.
//
// This is the one workflow with no automatic behaviour anywhere behind it: a
// slot time passing does nothing, the grace period expiring does nothing, and
// a patient walking in an hour late still keeps their appointment until a
// human at the desk decides otherwise. The tests below are therefore mostly
// about what the screen OFFERS, because the offer is the whole feature.
//
// Every fixture sits at a slot that has already gone by. That is deliberate:
// the booking-driven specs skip once the clinic closes because no future slot
// exists, but lateness only ever concerns past slots, so these run at any hour.
test.describe('receptionist late-arrival decision', () => {
  let doctor;
  let patient;
  let patientCleanup;
  let receptionist;
  let slots;
  const created = [];

  test.beforeAll(async () => {
    await connect();
    ({ doctor, receptionist } = await actors());
    ({ patient, cleanup: patientCleanup } = await testPatient());
    slots = await pastFreeSlotsToday(doctor, 6);
  });

  test.afterEach(async () => {
    while (created.length) {
      const made = created.pop();
      await WaitingListEntry.deleteMany({
        sourceAppointmentId: made.appointment._id,
      });
      await made.cleanup();
    }
  });

  test.afterAll(async () => {
    await patientCleanup();
    await disconnect();
  });

  // A fresh name per test keeps rows unambiguous: the shared database already
  // holds real bookings, and `hasText` would otherwise match more than one.
  async function seed({ name, minutesAfterSlot, index = 0, ...rest }) {
    const slot = slots[index];
    test.skip(!slot, 'the doctor has no unbooked past slots today');

    const made = await makeLateAppointment({
      doctor,
      patient,
      slot,
      minutesAfterSlot,
      patientName: name,
      ...rest,
    });

    created.push(made);
    return made.appointment;
  }

  async function openReception(page) {
    await loginAs(page, 'receptionistToken', signReceptionist(receptionist._id));
    await page.goto('/receptionist');
  }

  const rowFor = (page, name) =>
    page.locator('tr', { hasText: name }).first();

  test('a patient who arrives on time is just in the normal queue', async ({
    page,
  }) => {
    await seed({ name: 'OnTime Probe', minutesAfterSlot: 0 });
    await openReception(page);

    const row = rowFor(page, 'OnTime Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    await expect(row).toContainText(/checked in — within grace period/i);
    await expect(
      row.getByRole('button', { name: /move to waiting list/i }),
      'an on-time patient must never be offered the waiting list'
    ).toHaveCount(0);
  });

  // The boundary the rule is actually written on. "At or before T+5" means
  // T+5 itself is still on time, and an off-by-one here is the difference
  // between a patient keeping their appointment and losing it.
  test('arriving at exactly the grace limit is still on time', async ({
    page,
  }) => {
    await seed({ name: 'Grace Edge Probe', minutesAfterSlot: 5 });
    await openReception(page);

    const row = rowFor(page, 'Grace Edge Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    await expect(row).toContainText(/checked in — within grace period/i);
    await expect(
      row.getByRole('button', { name: /move to waiting list/i })
    ).toHaveCount(0);
  });

  test('one minute past the grace limit makes them eligible, not moved', async ({
    page,
  }) => {
    await seed({ name: 'Grace Over Probe', minutesAfterSlot: 6 });
    await openReception(page);

    const row = rowFor(page, 'Grace Over Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    await expect(row).toContainText(/late — beyond 5-minute grace period/i);
    await expect(row).toContainText(/6 min late/i);

    // BOTH options, side by side. The decision is reception's, and a screen
    // that offers only one of them is not offering a decision.
    await expect(
      row.getByRole('button', { name: /keep in queue/i }),
      'reception must be able to keep them'
    ).toBeVisible();
    await expect(
      row.getByRole('button', { name: /move to waiting list/i }),
      'reception must be able to move them'
    ).toBeVisible();

    // Eligible is not the same as moved. Until the button is pressed the
    // patient still holds their slot and their place in the queue.
    await expect(row).toContainText(/waiting/i);
    const stored = await Appointment.findOne({
      patientName: 'Grace Over Probe',
    }).lean();
    expect(stored.status).toBe('Waiting');
  });

  // Late is measured from ARRIVAL, not from the current clock. Someone who
  // walked in three minutes late is three minutes late for good, however long
  // the doctor then keeps them waiting.
  test('lateness is frozen at arrival, not recomputed from the clock', async ({
    page,
  }) => {
    await seed({ name: 'Frozen Probe', minutesAfterSlot: 2 });
    await openReception(page);

    const row = rowFor(page, 'Frozen Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    // The slot is long past, so a clock-based rule would call this patient
    // badly late; an arrival-based one keeps them on time.
    await expect(row).toContainText(/checked in — within grace period/i);
  });

  test('a patient who has not arrived is shown as overdue, never as movable', async ({
    page,
  }) => {
    await seed({ name: 'NoArrival Probe', minutesAfterSlot: null });
    await openReception(page);

    const row = rowFor(page, 'NoArrival Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    await expect(row).toContainText(/not arrived — \d+ min past slot/i);

    // You cannot hand a vacancy to someone who is not in the building, so the
    // only decisions offered are still Check In and Cancel.
    await expect(
      row.getByRole('button', { name: /move to waiting list/i })
    ).toHaveCount(0);
    await expect(row.getByRole('button', { name: /check in/i })).toBeVisible();
  });

  // A finished visit is out of the queue entirely - it is not "late", it is
  // over. The interesting half is the server: reception's screen offers
  // nothing for a completed patient, but a stale page or a hand-made request
  // must be refused too, because moving them would hand a second slot to
  // someone whose visit already happened.
  test('a completed visit leaves the queue and cannot be moved', async ({
    page,
    request,
  }) => {
    const appointment = await seed({
      name: 'Completed Probe',
      minutesAfterSlot: 45,
      status: 'Completed',
      // The model refuses to complete a visit without these, which is
      // correct - a finished consultation that recorded nothing is not
      // finished. The fixture has to satisfy the same rule the doctor does.
      diagnosis: 'automated test',
      prescription: 'automated test',
    });

    await openReception(page);

    // The queue shows patients still to be seen, so this one is gone from it.
    await expect(
      page.getByRole('heading', { name: 'Booked Appointments' })
    ).toBeVisible({
      timeout: 15_000,
    });
    await expect(rowFor(page, 'Completed Probe')).toHaveCount(0);

    const res = await request.post(`${API}/receptionist/waiting-list`, {
      headers: { Authorization: `Bearer ${signReceptionist(receptionist._id)}` },
      data: { appointmentId: String(appointment._id) },
      failOnStatusCode: false,
    });

    expect(res.status(), 'the server must refuse this, not just the UI').toBe(
      400
    );
    expect((await res.json()).message).toMatch(/already complete/i);
  });

  // The decision carried out: their slot is released as a genuine vacancy and
  // they are listed with their priority intact, rather than being cancelled.
  test('moving a late patient releases their slot and lists them', async ({
    page,
  }) => {
    const appointment = await seed({
      name: 'Moved Probe',
      minutesAfterSlot: 30,
      priority: 'High',
      priorityReason: 'Senior Citizen',
    });

    await openReception(page);

    const row = rowFor(page, 'Moved Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: /move to waiting list/i }).click();

    // They appear on the list, keeping the priority they were booked with.
    const list = page.locator('section', { hasText: 'Waiting / Vacant List' });
    await expect(list).toContainText('Moved Probe', { timeout: 15_000 });

    const entry = await WaitingListEntry.findOne({
      sourceAppointmentId: appointment._id,
    }).lean();
    expect(entry, 'the move must create a real waiting-list entry').toBeTruthy();
    expect(entry.status).toBe('Waiting');
    expect(entry.reason).toBe('Late arrival');
    // Inherited from the appointment, not reset to Normal. Reception sends
    // only the appointment id, so the server has to carry this across.
    expect(entry.priority, 'priority must survive the move').toBe('High');
    expect(entry.priorityReason).toBe('Senior Citizen');

    // And the slot they gave up is genuinely free again, not just hidden -
    // released rather than deleted, so the move stays auditable.
    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.status).toBe('Cancelled');
    expect(stored.slotActive, 'the slot must be a real vacancy').not.toBe(true);
  });
  // Cancelling a FUTURE booking, from the Upcoming bookings section.
  //
  // The desk saw "Appointment cancelled successfully" and the row stayed put,
  // Cancel button and all, so there was no way to tell whether it had worked.
  // It had - the cancel only ever refreshed today's queue, and Upcoming is a
  // separate fetch that nothing told about the change.
  test('cancelling an upcoming booking removes it from the list', async ({
    page,
  }) => {
    const slot = slots[0];
    test.skip(!slot, 'the doctor has no unbooked past slots today');

    // Tomorrow, so it lands in Upcoming bookings rather than today's queue.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const made = await makeLateAppointment({
      doctor,
      patient,
      slot,
      minutesAfterSlot: null,
      patientName: 'Upcoming Cancel Probe',
      appointmentDate: normalizeToIstDay(tomorrow),
    });
    created.push(made);

    await openReception(page);

    const row = page
      .locator('div', { hasText: 'Upcoming Cancel Probe' })
      .last();
    await expect(row).toBeVisible({ timeout: 15_000 });

    await page
      .getByRole('button', { name: 'Cancel Upcoming Cancel Probe' })
      .click();
    await page
      .getByRole('button', { name: /^cancel appointment$/i })
      .click();

    // Gone from the screen, not just from the database.
    await expect(
      page.getByText('Upcoming Cancel Probe'),
      'a cancelled booking must not still be listed'
    ).toHaveCount(0, { timeout: 15_000 });

    const stored = await Appointment.findById(made.appointment._id).lean();
    expect(stored.status).toBe('Cancelled');
  });

  // Known Bug #6: the server's reason reaching the person who has to act on
  // it. The API interceptor rejected with a bare Error, discarding
  // `err.response` - and most catch blocks in this app read
  // `err.response?.data?.message`, so they all fell through to their own
  // generic fallback. The desk was told "Failed to cancel appointment" while
  // the server was explaining exactly why.
  //
  // The failure is stubbed rather than provoked: what is under test is how
  // the app reports a server error, not any particular way of causing one.
  test('a failed cancel shows the reason the server gave', async ({ page }) => {
    await seed({ name: 'Refused Cancel Probe', minutesAfterSlot: null });

    await page.route('**/receptionist/appointments/*/cancel', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          message: 'That patient is already with the doctor',
        }),
      })
    );

    await openReception(page);

    const row = rowFor(page, 'Refused Cancel Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    await page.getByRole('button', { name: 'Cancel Refused Cancel Probe' }).click();
    await page.getByRole('button', { name: /^cancel appointment$/i }).click();

    await expect(
      page.getByText('That patient is already with the doctor'),
      "the server's reason must reach the desk"
    ).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText('Failed to cancel appointment')).toHaveCount(0);
  });

  // The whole point of the grace period: inside it there is no decision, so
  // no decision is offered. Showing the waiting-list control here would
  // invite reception to take a punctual patient's slot away.
  test('a patient within grace is offered no late-handling controls', async ({
    page,
  }) => {
    await seed({ name: 'Grace Controls Probe', minutesAfterSlot: 3 });
    await openReception(page);

    const row = rowFor(page, 'Grace Controls Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    await expect(row).toContainText(/checked in — within grace period/i);

    // The arrival time is printed so the desk can check the verdict against
    // the times it was drawn from.
    await expect(row).toContainText(/appointment .* · arrived/i);

    await expect(
      row.getByRole('button', { name: /keep in queue/i })
    ).toHaveCount(0);
    await expect(
      row.getByRole('button', { name: /move to waiting list/i })
    ).toHaveCount(0);
  });

  // KEEP IN QUEUE, through the UI. Nothing about the queue may change - the
  // patient keeps the slot, the priority and the position they already had.
  test('keeping a late patient leaves them in the queue', async ({ page }) => {
    const appointment = await seed({
      name: 'Kept Probe',
      minutesAfterSlot: 25,
      priority: 'High',
      priorityReason: 'Senior Citizen',
    });

    await openReception(page);

    const row = rowFor(page, 'Kept Probe');
    await expect(row).toBeVisible({ timeout: 15_000 });

    await row.getByRole('button', { name: /keep in queue/i }).click();

    // The question has been answered, so the row stops asking it.
    await expect(row).toContainText(/kept in queue by reception/i, {
      timeout: 15_000,
    });
    await expect(
      row.getByRole('button', { name: /keep in queue/i })
    ).toHaveCount(0);
    await expect(
      row.getByRole('button', { name: /move to waiting list/i })
    ).toHaveCount(0);

    // They are still a normal queue patient, holding their own slot.
    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.status).toBe('Waiting');
    expect(stored.slotActive).toBe(true);
    expect(stored.priority).toBe('High');
    expect(stored.keptInQueueAt).toBeTruthy();

    // And they were NOT put on the waiting list.
    const entry = await WaitingListEntry.findOne({
      sourceAppointmentId: appointment._id,
    }).lean();
    expect(entry, 'keeping a patient must not list them').toBeFalsy();
  });

  // The server is the authority, not the screen. A hand-made request for a
  // punctual patient must be refused even though the UI never offers it.
  test('the server refuses to move a patient inside the grace period', async ({
    page,
    request,
  }) => {
    const appointment = await seed({
      name: 'Server Guard Probe',
      minutesAfterSlot: 4,
    });

    const res = await request.post(`${API}/receptionist/waiting-list`, {
      headers: { Authorization: `Bearer ${signReceptionist(receptionist._id)}` },
      data: { appointmentId: String(appointment._id) },
      failOnStatusCode: false,
    });

    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/grace period/i);

    // Untouched: still holding their slot, still not listed.
    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.status).toBe('Waiting');
    expect(stored.slotActive).toBe(true);
  });

  // Layout regressions, asserted geometrically rather than by eye.
  //
  // Every one of these has actually happened on this dashboard: a button
  // label sitting outside its card, a long patient name pushing the actions
  // off the row, a slot dropdown wider than the panel holding it. Comparing
  // bounding boxes catches them; a screenshot diff would only say "something
  // moved".
  test.describe('layout', () => {
    test('no control spills outside the card that contains it', async ({
      page,
    }) => {
      await seed({ name: 'Overflowing Probe With A Very Long Name', minutesAfterSlot: 30 });
      await openReception(page);

      // Desktop: the width at which the action column is most cramped.
      await page.setViewportSize({ width: 1280, height: 900 });

      const row = rowFor(page, 'Overflowing Probe');
      await expect(row).toBeVisible({ timeout: 15_000 });

      // The page itself must not scroll sideways - the usual first symptom.
      const overflowsX = await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1
      );
      expect(overflowsX, 'the dashboard must not scroll horizontally').toBe(
        false
      );

      // Every button and dropdown must sit inside the scroll container it
      // belongs to. One pixel of tolerance absorbs sub-pixel rounding.
      const controls = row.locator('button, select');
      const count = await controls.count();
      expect(count).toBeGreaterThan(0);

      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) continue;

        const box = await control.boundingBox();
        const cell = await control
          .locator('xpath=ancestor::td[1]')
          .boundingBox();

        if (!box || !cell) continue;

        expect(
          box.width,
          'a control with no width has a clipped label'
        ).toBeGreaterThan(0);
        expect(box.right ?? box.x + box.width).toBeLessThanOrEqual(
          cell.x + cell.width + 1
        );
      }
    });

    test('a long patient name wraps instead of being cut off', async ({
      page,
    }) => {
      await seed({
        name: 'Venkatanarasimharajuvaripeta Balagurunathan',
        minutesAfterSlot: 2,
      });
      await openReception(page);

      const name = page
        .getByText('Venkatanarasimharajuvaripeta Balagurunathan')
        .first();
      await expect(name).toBeVisible({ timeout: 15_000 });

      // Wrapped, not truncated: the rendered box is taller than one line and
      // the full text is present rather than ellipsised.
      const box = await name.boundingBox();
      const style = await name.evaluate((el) => getComputedStyle(el).overflow);

      expect(box.width).toBeGreaterThan(0);
      expect(style, 'the name must not be clipped').not.toBe('hidden');
    });

    test('the waiting list keeps its controls inside the panel', async ({
      page,
    }) => {
      await openReception(page);

      const list = page.locator('section', { hasText: 'Waiting / Vacant List' });
      await expect(list).toBeVisible({ timeout: 15_000 });

      const panel = await list.boundingBox();
      const controls = list.locator('button, select');
      const count = await controls.count();

      for (let i = 0; i < count; i++) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) continue;

        const box = await control.boundingBox();
        if (!box) continue;

        expect(
          box.x + box.width,
          'a waiting-list control is outside its panel'
        ).toBeLessThanOrEqual(panel.x + panel.width + 1);
        expect(box.x).toBeGreaterThanOrEqual(panel.x - 1);
      }
    });

    // FLEX was removed. It must not come back through a stray label.
    test('nothing on the dashboard mentions FLEX', async ({ page }) => {
      await openReception(page);

      const list = page.locator('section', { hasText: 'Waiting / Vacant List' });
      await expect(list).toBeVisible({ timeout: 15_000 });

      await expect(page.locator('body')).not.toContainText(/flex/i);
    });
  });
});
