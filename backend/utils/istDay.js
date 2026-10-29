// Appointment.appointmentDate is stored normalized to IST midnight expressed
// in UTC (see the pre-save hook in models/Appointment.js). Anything that wants
// to match a stored date exactly has to normalize the same way.
//
// Using `new Date(x).setHours(0,0,0,0)` instead is a trap: setHours works in
// the SERVER's timezone, so it produces IST midnight on a machine set to IST
// and UTC midnight on one set to UTC. The two agree in local development and
// disagree in production, which is exactly the kind of bug that only appears
// once deployed - a token lookup silently matched nothing on a UTC host,
// handed out an already-used token number, and surfaced as a misleading
// "This slot is already booked."
const IST_OFFSET = 5.5 * 60 * 60 * 1000;

function normalizeToIstDay(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  const shifted = new Date(date.getTime() + IST_OFFSET);
  return new Date(
    Date.UTC(
      shifted.getUTCFullYear(),
      shifted.getUTCMonth(),
      shifted.getUTCDate(),
      0,
      0,
      0,
      0
    ) - IST_OFFSET
  );
}

module.exports = { normalizeToIstDay, IST_OFFSET };
