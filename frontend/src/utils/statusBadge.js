// Single source of truth for status -> badge styling, so the same
// appointment status always looks identical everywhere it's shown
// (Doctor Dashboard, Appointments, Appointment Details, My Appointments,
// Patient History, Receptionist queue). Class names map to the shared
// .badge-* components defined in index.css.
const STATUS_BADGE_CLASSES = {
  Waiting: "badge-waiting",
  "In Consultation": "badge-serving",
  Completed: "badge-completed",
  Cancelled: "badge-cancelled",
};

export function getStatusBadgeClass(status) {
  return STATUS_BADGE_CLASSES[status] || "badge-neutral";
}

const AVAILABILITY_BADGE_CLASSES = {
  AVAILABLE: "badge-available",
  LIMITED: "badge-limited",
  UNAVAILABLE: "badge-unavailable",
};

export function getAvailabilityBadgeClass(availabilityStatus) {
  return AVAILABILITY_BADGE_CLASSES[availabilityStatus] || "badge-neutral";
}
