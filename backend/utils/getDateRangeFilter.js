// utils/getDateRangeFilter.js
const getISTDayRange = require("./getISTDayRange");

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

// Same day-boundary math as getISTDayRange, but for an arbitrary calendar
// date rather than "now" - used to build the "tomorrow" / custom-range
// filters below on the same IST-calendar-day basis every other
// date-boundary query in this app already relies on.
function istDayBounds(dateInput) {
  const d = new Date(dateInput);

  if (isNaN(d.getTime())) {
    return null;
  }

  const istShifted = new Date(d.getTime() + IST_OFFSET);
  const year = istShifted.getUTCFullYear();
  const month = istShifted.getUTCMonth();
  const day = istShifted.getUTCDate();

  return {
    start: new Date(Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET),
    end: new Date(Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET),
  };
}

/**
 * Builds a Mongo $gte/$lte filter for `appointmentDate` from either a named
 * `range` ("today" | "tomorrow" | "week") or an explicit `startDate`/`endDate`
 * pair. Returns null when neither is provided (caller should fall back to
 * its existing default behavior).
 *
 * Throws on an unparseable startDate/endDate so callers can surface a 400.
 */
function getDateRangeFilter({ range, startDate, endDate }) {
  const { todayStart, todayEnd } = getISTDayRange();

  if (range === "today") {
    return { $gte: todayStart, $lte: todayEnd };
  }

  if (range === "tomorrow") {
    const bounds = istDayBounds(todayStart.getTime() + 24 * 60 * 60 * 1000);
    return { $gte: bounds.start, $lte: bounds.end };
  }

  if (range === "week") {
    const weekEnd = new Date(todayEnd.getTime() + 6 * 24 * 60 * 60 * 1000);
    return { $gte: todayStart, $lte: weekEnd };
  }

  if (startDate || endDate) {
    const startBounds = startDate ? istDayBounds(startDate) : null;
    const endBounds = endDate ? istDayBounds(endDate) : null;

    if ((startDate && !startBounds) || (endDate && !endBounds)) {
      throw new Error("Invalid date format");
    }

    const filter = {};

    if (startBounds) filter.$gte = startBounds.start;
    if (endBounds) filter.$lte = endBounds.end;

    return filter;
  }

  return null;
}

module.exports = { getDateRangeFilter, istDayBounds };
