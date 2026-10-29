import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Buildings, CalendarBlank, Clock, CurrencyInr } from "@phosphor-icons/react";
import { getSpecialtyVisual } from "../constants/specialties";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import DoctorAvatar from "../components/DoctorAvatar";
import PublicNav from "../components/PublicNav";
import { formatWorkingDays, formatTime12 } from "../utils/doctorDisplay";

// Light-only badge styling - mirrors DoctorListItem.jsx's rationale: this
// is part of the public patient-facing discovery experience, which stays
// light regardless of the global theme toggle used by the dashboards.
const AVAILABILITY_STYLES = {
  AVAILABLE: { label: "Available Today", cls: "bg-success-50 text-success-700", dot: "bg-success-500" },
  LIMITED: { label: "Limited Slots", cls: "bg-amber-50 text-amber-700", dot: "bg-amber-500" },
  UNAVAILABLE: { label: "Unavailable", cls: "bg-gray-100 text-gray-500", dot: "bg-gray-400" },
};

function getAvailability(doctor) {
  if (!doctor.isAvailable) return AVAILABILITY_STYLES.UNAVAILABLE;
  return AVAILABILITY_STYLES[doctor.availabilityStatus] || AVAILABILITY_STYLES.AVAILABLE;
}

function DoctorPublicProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [doctor, setDoctor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchDoctor = useCallback(
    async (signal) => {
      setLoading(true);
      setError(null);
      try {
        const res = await API.get(`/doctors/${id}`, { signal });
        setDoctor(res.data.doctor);
      } catch (err) {
        if (
          err.name === "CanceledError" ||
          err.name === "AbortError" ||
          err.code === "ERR_CANCELED"
        ) {
          return;
        }
        const msg = err.response?.data?.message || "Failed to load doctor profile.";
        setError(msg);
        toastRef.current?.error(msg);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [id]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchDoctor(controller.signal);
    return () => controller.abort();
  }, [fetchDoctor]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <PublicNav />
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-primary-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Loading doctor profile...</p>
        </div>
      </div>
    );
  }

  if (error || !doctor)
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <PublicNav />
        <div className="px-4 sm:px-6 lg:px-8 py-24 flex items-center justify-center">
          <div className="bg-white border border-gray-200 p-8 rounded-2xl text-center max-w-md">
            <h2 className="text-xl font-semibold text-gray-900 mb-2">{error || "Doctor not found"}</h2>
            <button onClick={() => navigate("/doctors")} className="btn-primary mt-4">
              Back to Doctors
            </button>
          </div>
        </div>
      </div>
    );

  const availability = getAvailability(doctor);
  const { Icon: SpecialtyIcon, chip: specialtyChip } = getSpecialtyVisual(doctor.specialization);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <PublicNav />
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
        <button
          onClick={() => navigate(-1)}
          className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1.5 mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" aria-hidden />
          Back
        </button>

        <div className="bg-white border border-gray-200/70 rounded-2xl p-6 sm:p-8 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)]">
          <div className="flex flex-col sm:flex-row sm:items-start gap-5 mb-6">
            <DoctorAvatar name={doctor.name} size="lg" />

            <div className="flex-1 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <h1 className="text-2xl font-semibold text-gray-900">{doctor.name}</h1>
                  {doctor.qualification && (
                    <p className="text-sm text-gray-500 mt-0.5">{doctor.qualification}</p>
                  )}
                  <span className={`inline-flex items-center gap-1.5 mt-2 pl-1.5 pr-3 py-1 rounded-full text-sm font-semibold ${specialtyChip}`}>
                    <SpecialtyIcon weight="duotone" className="w-4 h-4" aria-hidden />
                    {doctor.specialization}
                  </span>
                </div>

                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium shrink-0 ${availability.cls}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${availability.dot}`} />
                  {availability.label}
                </span>
              </div>

              <p className="text-sm text-gray-500 mt-2">{doctor.experience}+ years experience</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="p-4 bg-gray-50 rounded-xl flex gap-3">
              <Buildings weight="duotone" className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-[#6B7280] mb-1">Hospital / Location</p>
                <p className="font-semibold text-[#111827]">{doctor.location}</p>
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl flex gap-3">
              <CurrencyInr weight="duotone" className="w-5 h-5 text-secondary-700 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-[#6B7280] mb-1">Consultation Fee</p>
                <p className="font-semibold text-[#111827]">₹{doctor.consultationFee}</p>
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl flex gap-3">
              <Clock weight="duotone" className="w-5 h-5 text-primary-600 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-[#6B7280] mb-1">Working Hours</p>
                <p className="font-semibold text-[#111827]">{formatWorkingDays(doctor.workingDays)}</p>
                {doctor.workingHours?.start && doctor.workingHours?.end && (
                  <p className="text-sm text-[#6B7280]">
                    {formatTime12(doctor.workingHours.start)} - {formatTime12(doctor.workingHours.end)}
                  </p>
                )}
              </div>
            </div>
            <div className="p-4 bg-gray-50 rounded-xl flex gap-3">
              <CalendarBlank weight="duotone" className="w-5 h-5 text-secondary-700 shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0">
                <p className="text-xs text-[#6B7280] mb-1">Next Available</p>
                <p className="font-semibold text-[#111827]">{doctor.nextAvailableSlot || "No slots available"}</p>
                {doctor.availabilityStatus !== "UNAVAILABLE" && (
                  <p className="text-sm text-[#6B7280]">{doctor.remainingSlotsToday ?? 0} slots left today</p>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={() => navigate(`/book/${doctor._id}`)}
            disabled={!doctor.isAvailable}
            className="btn-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {doctor.isAvailable ? "Book Appointment" : "Currently Unavailable"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DoctorPublicProfile;
