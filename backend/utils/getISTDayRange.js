// utils/getISTDayRange.js

const IST_OFFSET = 5.5 * 60 * 60 * 1000;

/**
 * Returns the UTC Date objects that correspond to the start (00:00:00.000)
 * and end (23:59:59.999) of "today" in India Standard Time.
 *
 * Every route that needs to know what "today" means must use this helper
 * so that Dashboard Stats, Dashboard Analytics, Next Patient, CSV Export,
 * Live Queue, Check-in, and Start Consultation all agree on the same
 * day boundaries.
 *
 * @param {Date} [referenceDate=new Date()] - optional reference instant
 * @returns {{ todayStart: Date, todayEnd: Date }}
 */
function getISTDayRange(referenceDate = new Date()) {
  const istNow = new Date(referenceDate.getTime() + IST_OFFSET);

  const year = istNow.getUTCFullYear();
  const month = istNow.getUTCMonth();
  const day = istNow.getUTCDate();

  const todayStart = new Date(
    Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
  );

  const todayEnd = new Date(
    Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
  );

  return { todayStart, todayEnd };
}

module.exports = getISTDayRange;