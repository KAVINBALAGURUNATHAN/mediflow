// Honest placeholder, not a fake photo - the Doctor model has no photo
// field anywhere in the backend (same rationale as Sidebar.jsx's
// InitialsAvatar). Color is deterministically derived from the doctor's
// name purely for visual variety across a list, not real data.
// Forced light-only palette - this is used exclusively on the public
// patient-facing discovery pages (Doctors.jsx, DoctorPublicProfile.jsx).
const TONES = [
  "bg-primary-50 text-primary-700",
  "bg-secondary-50 text-secondary-700",
  "bg-violet-50 text-violet-700",
  "bg-success-50 text-success-700",
  "bg-amber-50 text-amber-700",
];

function toneForName(name) {
  const code = (name || "?").charCodeAt(0) || 0;
  return TONES[code % TONES.length];
}

function DoctorAvatar({ name, size = "md", className = "" }) {
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  const sizeCls = size === "lg" ? "w-20 h-20 text-2xl" : size === "sm" ? "w-10 h-10 text-sm" : "w-16 h-16 text-xl";

  return (
    <div
      className={`${sizeCls} rounded-2xl flex items-center justify-center font-semibold shrink-0 transition-transform duration-200 group-hover-scale-105 ${toneForName(name)} ${className}`}
    >
      {initial}
    </div>
  );
}

export default DoctorAvatar;
