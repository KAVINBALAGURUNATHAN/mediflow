// Shared formatting helpers for doctor cards / profile - used by both
// Doctors.jsx and DoctorPublicProfile.jsx so the two views can never
// drift out of sync with each other.

const WEEKDAY_ORDER = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

// Compresses a working-days array into a compact display range, e.g.
// ["Monday", ..., "Saturday"] -> "Mon–Sat". Falls back to a comma-joined
// abbreviation list for non-contiguous selections.
export function formatWorkingDays(days) {
  if (!days || days.length === 0) return "Not set";

  const indices = days
    .map((d) => WEEKDAY_ORDER.indexOf(d))
    .filter((i) => i >= 0)
    .sort((a, b) => a - b);

  if (indices.length === 0) return "Not set";

  const abbr = (idx) => WEEKDAY_ORDER[idx].slice(0, 3);
  const isContiguous = indices.every((idx, i) => i === 0 || idx === indices[i - 1] + 1);

  if (isContiguous && indices.length > 1) {
    return `${abbr(indices[0])}–${abbr(indices[indices.length - 1])}`;
  }

  return indices.map(abbr).join(", ");
}

// "09:00" (24hr, as stored) -> "09:00 AM"
export function formatTime12(hhmm) {
  if (!hhmm) return "";
  const [h, m] = hhmm.split(":").map(Number);
  const period = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(m).padStart(2, "0")} ${period}`;
}

const AVAILABILITY_INFO = {
  AVAILABLE: { label: "Available", cls: "badge-available", dot: "bg-success-500" },
  LIMITED: { label: "Limited", cls: "badge-limited", dot: "bg-warning-500" },
  UNAVAILABLE: { label: "Unavailable", cls: "badge-unavailable", dot: "bg-danger-500" },
};

export function getAvailabilityInfo(availabilityStatus, isAvailable) {
  return (
    AVAILABILITY_INFO[availabilityStatus] ||
    (isAvailable ? AVAILABILITY_INFO.AVAILABLE : AVAILABILITY_INFO.UNAVAILABLE)
  );
}
