import { test, expect } from '@playwright/test';
import {
  api,
  connect,
  disconnect,
  actors,
  freeSlotToday,
  makeAppointment,
  istDateString,
} from './helpers/backend.js';

// Regression cover for a bug that reached production twice: the available-slot
// query built its day window with setHours, which resolves in the server's
// timezone, while appointment dates are stored at IST midnight. The two agree
// on an IST machine and diverge on a UTC host, so booked and blocked slots
// stopped being filtered out of the list entirely.
//
// A unit test cannot catch that on its own - it only shows up when the stored
// value and the query are produced by different code paths, which is exactly
// what these exercise.
test.describe('slot availability', () => {
  let doctor;
  let patient;

  test.beforeAll(async () => {
    await connect();
    ({ doctor, patient } = await actors());
  });

  test.afterAll(async () => {
    await disconnect();
  });

  test('a booked slot disappears, and cancelling puts it back', async () => {
    const slot = await freeSlotToday(doctor);
    test.skip(!slot, 'the doctor has no free slots left today');

    const today = istDateString();
    const slotsPath = `/doctors/${doctor._id}/slots?date=${today}`;

    const before = await api(slotsPath);
    expect(before.status).toBe(200);
    expect(before.body.slots, 'chosen slot should start free').toContain(slot);

    const { appointment, cleanup } = await makeAppointment({
      doctor,
      patient,
      slot,
    });

    try {
      const booked = await api(slotsPath);
      expect(
        booked.body.slots,
        'a booked slot must not still be offered'
      ).not.toContain(slot);
      expect(booked.body.availableSlots).toBe(before.body.availableSlots - 1);

      // Cancelling has to release the slot - this is the slotActive partial
      // index doing its job, and it is what makes rebooking possible.
      appointment.status = 'Cancelled';
      await appointment.save();

      const cancelled = await api(slotsPath);
      expect(
        cancelled.body.slots,
        'a cancelled slot must become bookable again'
      ).toContain(slot);
    } finally {
      await cleanup();
    }
  });

  test('the slots endpoint refuses a date in the past', async () => {
    const yesterday = istDateString(new Date(Date.now() - 86_400_000));

    const res = await api(`/doctors/${doctor._id}/slots?date=${yesterday}`);
    expect(res.status).toBe(400);
  });
});
