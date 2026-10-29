// Queue ordering shared by every screen that shows a waiting list.
//
// Priority exists so reception can pull a walk-in emergency (or a senior
// citizen, pregnant or disabled patient) forward without cancelling and
// rebooking anyone. That only works if the queues actually order by it:
// previously the priority was stored and badged, but the doctor's live queue
// and "next patient" still called people strictly in appointment-time order,
// so marking someone High changed a label and nothing else.
//
// Mirrors the ranking the waiting-room board (LiveQueueBoard.jsx) already
// used, so the board, the doctor and reception now agree on who is next.
// Note this cannot be expressed as a MongoDB .sort() on `priority` - that
// would sort the strings alphabetically ("High" < "Low" < "Normal"), which
// is not the intended order - so ranking happens in memory.
const PRIORITY_RANK = { High: 3, Normal: 2, Low: 1 };

function rankOf(appointment) {
  return PRIORITY_RANK[appointment?.priority] || PRIORITY_RANK.Normal;
}

// "09:00 AM" -> minutes since midnight, for time-of-day ordering.
function slotToMinutes(slot) {
  if (!slot || typeof slot !== "string") return 0;

  const [time, meridiem] = slot.split(" ");
  if (!time || !meridiem) return 0;

  let [hours, minutes] = time.split(":").map(Number);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 0;

  if (meridiem.toLowerCase() === "pm" && hours !== 12) hours += 12;
  if (meridiem.toLowerCase() === "am" && hours === 12) hours = 0;

  return hours * 60 + minutes;
}

// Higher priority first, then appointment time, then token number so the
// order is stable for everyone at the same priority and slot.
function byQueueOrder(a, b) {
  const rankDiff = rankOf(b) - rankOf(a);
  if (rankDiff !== 0) return rankDiff;

  const slotDiff = slotToMinutes(a.slot) - slotToMinutes(b.slot);
  if (slotDiff !== 0) return slotDiff;

  return (a.tokenNumber || 0) - (b.tokenNumber || 0);
}

module.exports = { PRIORITY_RANK, rankOf, slotToMinutes, byQueueOrder };
