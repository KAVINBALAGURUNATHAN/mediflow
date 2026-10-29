// "Has this patient physically arrived?"
//
// This used to be answered with `tokenNumber !== null`, and that was correct
// while tokens were handed out at the desk on arrival. Tokens are now assigned
// when the appointment is BOOKED - so the patient is visible in the queue and
// can follow their position from home - which means every booked patient has a
// token and that test silently became "has an appointment".
//
// checkedInAt is the only field that means arrival, and it is set in exactly
// one place: the receptionist's check-in. Anything deciding whether someone is
// in the room must go through here rather than re-deriving it, because each
// call site that re-derived it is a place this bug came back.
export function isCheckedIn(patient) {
  return Boolean(patient?.checkedInAt);
}

// In the queue right now: arrived, and not yet finished or cancelled. Used for
// the live queue board and the timeline strip, which should show the room as it
// actually is rather than everyone booked for the day.
export function isInQueue(patient) {
  const status = patient?.status?.toLowerCase();
  return (
    isCheckedIn(patient) && status !== 'completed' && status !== 'cancelled'
  );
}

// Booked but not yet arrived - the receptionist's "still to come" count.
export function isAwaitingCheckIn(patient) {
  const status = patient?.status?.toLowerCase();
  return (
    !isCheckedIn(patient) && status !== 'completed' && status !== 'cancelled'
  );
}
