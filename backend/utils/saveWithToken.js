const { normalizeToIstDay } = require("./istDay");

/**
 * Saves a NEW appointment, assigning the next token number for its doctor and
 * day, retrying if another booking takes that number first.
 *
 * Extracted from the booking endpoint so there is one implementation. It was
 * duplicated the moment a second path could create an appointment (assigning a
 * waiting-list patient to a vacancy), and a second copy would have drifted:
 * the first version of that path forgot the token entirely, which silently
 * hides the patient from GET /doctor/live-queue - that endpoint filters on
 * `tokenNumber: { $ne: null }`, so a tokenless appointment is booked, holds its
 * slot, and never appears in the doctor's queue.
 *
 * The day is matched against the NORMALIZED value the model actually stores,
 * not a `setHours`-derived one: setHours resolves in the server's timezone, so
 * on a UTC host it never equalled the IST-normalized stored date. The lookup
 * then found no previous token, reissued one already held by a cancelled
 * appointment that day, and the duplicate-key error surfaced to the patient as
 * "This slot is already booked."
 *
 * @param {import("mongoose").Model} Appointment
 * @param {import("mongoose").Document} appointment - unsaved
 * @param {Date} day - any instant on the appointment's day
 * @returns {Promise<import("mongoose").Document>} the saved appointment
 */
async function saveWithToken(Appointment, appointment, day) {
  const normalizedDay = normalizeToIstDay(day);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const lastToken = await Appointment.findOne({
      doctorId: appointment.doctorId,
      appointmentDate: normalizedDay,
      tokenNumber: { $ne: null },
    })
      .sort({ tokenNumber: -1 })
      .select("tokenNumber");

    appointment.tokenNumber = (lastToken?.tokenNumber || 0) + 1;

    try {
      await appointment.save();
      return appointment;
    } catch (saveError) {
      const isDuplicateToken =
        saveError?.code === 11000 &&
        "tokenNumber" in (saveError.keyPattern || {});

      // Anything else - including a genuine slot clash - is the caller's
      // problem, not something to retry.
      if (!isDuplicateToken || attempt === 4) throw saveError;
    }
  }

  return appointment;
}

module.exports = { saveWithToken };
