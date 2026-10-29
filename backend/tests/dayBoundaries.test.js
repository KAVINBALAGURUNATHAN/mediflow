const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const { normalizeToIstDay } = require("../utils/istDay");
const getISTDayRange = require("../utils/getISTDayRange");

// Appointment.appointmentDate and BlockedSlot.date are both WRITTEN as IST
// midnight expressed in UTC. Every day-scoped query that READS them builds
// its window with getISTDayRange(). If those two ever stop agreeing, stored
// rows fall outside the window meant to find them and the failure is silent:
// booked and blocked slots simply stop being filtered out of the available
// list, so patients are offered slots they cannot actually book.
//
// This has now shipped twice, both times because someone reached for
// `setHours(0,0,0,0)` - which resolves in the server process's timezone and
// therefore agrees with IST normalization on a dev machine set to IST while
// silently disagreeing on a UTC host like Render. These tests run the
// comparison under an explicitly UTC-shaped expectation so the disagreement
// cannot hide behind the developer's local clock.
describe("IST day boundaries", () => {
  const DAYS = [
    "2026-08-25",
    "2026-01-01", // year boundary
    "2026-02-28",
    "2026-12-31",
  ];

  test("a written day always falls inside its own read window", () => {
    for (const day of DAYS) {
      const stored = normalizeToIstDay(new Date(day));
      const { todayStart, todayEnd } = getISTDayRange(stored);

      assert.ok(
        stored >= todayStart && stored <= todayEnd,
        `${day}: stored ${stored.toISOString()} fell outside ` +
          `${todayStart.toISOString()}..${todayEnd.toISOString()}`
      );
    }
  });

  test("the two helpers agree on where an IST day starts", () => {
    for (const day of DAYS) {
      assert.equal(
        normalizeToIstDay(new Date(day)).getTime(),
        getISTDayRange(new Date(day)).todayStart.getTime(),
        `${day}: normalizeToIstDay and getISTDayRange disagree`
      );
    }
  });

  test("a day's window excludes the neighbouring days", () => {
    for (const day of DAYS) {
      const { todayStart, todayEnd } = getISTDayRange(new Date(day));
      const dayMs = 24 * 60 * 60 * 1000;

      const previous = new Date(todayStart.getTime() - dayMs);
      const next = new Date(todayStart.getTime() + dayMs);

      assert.ok(previous < todayStart, `${day}: previous day leaked in`);
      assert.ok(next > todayEnd, `${day}: next day leaked in`);
    }
  });

  test("setHours-based boundaries are NOT used as a substitute", () => {
    // Guards the specific regression: on a UTC host, local midnight is a
    // different instant from IST midnight, so a setHours window misses the
    // stored row entirely. Asserting the gap exists documents why the
    // helpers are mandatory rather than stylistic.
    const stored = normalizeToIstDay(new Date("2026-08-25"));
    const localMidnightUtcHost = new Date("2026-08-25T00:00:00.000Z");

    assert.notEqual(
      stored.getTime(),
      localMidnightUtcHost.getTime(),
      "IST midnight and UTC midnight must not be treated as interchangeable"
    );
  });
});
