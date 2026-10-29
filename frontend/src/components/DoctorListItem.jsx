import { useNavigate } from "react-router-dom";
import { MapPin } from "@phosphor-icons/react";
import DoctorAvatar from "./DoctorAvatar";
import { formatWorkingDays, formatTime12 } from "../utils/doctorDisplay";

// Light-only badge styling, deliberately not reusing the shared
// badge-available/limited/unavailable classes from index.css - those carry
// dark: variants meant for the internal dashboards. This card is part of
// the public patient-facing discovery experience, which stays light
// regardless of the global theme toggle.
const AVAILABILITY_STYLES = {
  AVAILABLE: { label: "Available Today", cls: "bg-success-50 text-success-700", dot: "bg-success-500" },
  LIMITED: { label: "Limited Slots", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  UNAVAILABLE: { label: "Unavailable", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-400" },
};

function getAvailability(doctor) {
  if (!doctor.isAvailable) return AVAILABILITY_STYLES.UNAVAILABLE;
  return AVAILABILITY_STYLES[doctor.availabilityStatus] || AVAILABILITY_STYLES.AVAILABLE;
}

// Full-width directory row (Practo/Zocdoc-style), replacing the old
// isolated grid card. Shows only fields the backend actually returns for
// a doctor - see models/Doctor.js - no fabricated ratings, reviews,
// languages, or photos.
function DoctorListItem({ doctor }) {
  const navigate = useNavigate();
  const availability = getAvailability(doctor);

  return (
    <div className="group relative bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.14)] transition duration-200">
      {/* Top accent bar */}
      <div className="h-1 bg-primary-600" aria-hidden="true" />

      <div className="p-5 sm:p-6 flex flex-col sm:flex-row gap-5">
        {/* Avatar + identity */}
        <div className="flex gap-4 sm:w-72 shrink-0">
          <DoctorAvatar name={doctor.name} size="lg" />

          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-slate-900 truncate">{doctor.name}</h3>
            {doctor.qualification && (
              <p className="text-xs text-slate-500 truncate">{doctor.qualification}</p>
            )}
            <span className="inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-50 text-primary-700">
              {doctor.specialization}
            </span>
            <p className="text-xs text-slate-500 mt-1.5">{doctor.experience}+ years experience</p>
          </div>
        </div>

        {/* Practice details */}
        <div className="flex-1 min-w-0 sm:border-l sm:border-slate-100 sm:pl-5">
          <div className="flex items-start gap-2 text-sm text-slate-700 mb-2">
            <MapPin weight="duotone" className="w-4 h-4 shrink-0 mt-0.5 text-slate-500" aria-hidden />
            <span>{doctor.location}</span>
          </div>

          <p className="text-xs text-slate-500 mb-3">
            {formatWorkingDays(doctor.workingDays)}
            {doctor.workingHours?.start && doctor.workingHours?.end && (
              <> · {formatTime12(doctor.workingHours.start)} - {formatTime12(doctor.workingHours.end)}</>
            )}
          </p>

          <div className="flex items-center flex-wrap gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${availability.cls}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${availability.dot}`} />
              {availability.label}
            </span>
            <span className="text-xs text-slate-600">
              Next: <span className="font-semibold text-slate-900">{doctor.nextAvailableSlot || "No slots available"}</span>
            </span>
            {doctor.availabilityStatus !== "UNAVAILABLE" && (
              <span className="text-xs text-slate-500">
                {doctor.remainingSlotsToday ?? 0} slots left today
              </span>
            )}
          </div>
        </div>

        {/* Fee + actions */}
        <div className="sm:w-48 shrink-0 flex sm:flex-col justify-between sm:justify-start gap-3 sm:border-l sm:border-slate-100 sm:pl-5">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500">Consultation Fee</p>
            <p className="text-xl font-bold font-mono text-slate-900 mt-1">₹{doctor.consultationFee}</p>
          </div>

          <div className="flex sm:flex-col gap-2 sm:mt-2">
            <button
              onClick={() => navigate(`/book/${doctor._id}`)}
              disabled={!doctor.isAvailable}
              className="flex-1 sm:w-full inline-flex items-center justify-center h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {doctor.isAvailable ? "Book Appointment" : "Unavailable"}
            </button>
            <button
              onClick={() => navigate(`/doctors/${doctor._id}`)}
              className="flex-1 sm:w-full inline-flex items-center justify-center h-11 px-5 rounded-full text-sm font-semibold border border-slate-300 text-slate-700 bg-white hover:bg-slate-50 active:scale-[0.98] transition duration-150"
            >
              View Profile
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DoctorListItem;
