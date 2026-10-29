import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import PublicNav from "../components/PublicNav";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import DoctorAvatar from "../components/DoctorAvatar";
import { useBranch } from "../context/BranchContext";

// Public/patient-facing booking wizard - deliberately forced to a light
// theme (no `dark:` classes anywhere in this file), matching the rest of
// the patient discovery surface (Doctors.jsx, DoctorPublicProfile.jsx).
// The shared `.glass-card`/`.input`/`.page-heading` classes carry `dark:`
// variants tied to the global dashboard theme toggle, so this file uses
// raw Tailwind utilities instead to guarantee it never flips dark.
function BookAppointment() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { branch } = useBranch();

  const [doctor, setDoctor] = useState(null);
  const [slots, setSlots] = useState([]);
  const [date, setDate] = useState("");
  const [booking, setBooking] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  const today = new Date().toISOString().split("T")[0];

  const [form, setForm] = useState({
    patientName: "",
    age: "",
    phone: "",
    bloodGroup: "",
    symptoms: "",
    medicalConditions: "",
    currentMedications: "",
    slot: "",
  });

  useEffect(() => {
    loadDoctor();
  }, [id]);

  useEffect(() => {
  const isCompleteValidDate =
    /^\d{4}-\d{2}-\d{2}$/.test(date);

  if (isCompleteValidDate && new Date(date) >= new Date(new Date().toDateString())) {
    loadSlots();
  }
}, [date, id]);

  const loadDoctor = async () => {
    try {
      const res = await API.get(`/doctors/${id}`);
      setDoctor(res.data.doctor);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load doctor");
    }
  };

  const loadSlots = async () => {
    try {
      const res = await API.get(`/doctors/${id}/slots?date=${date}`);
      setSlots(res.data.slots);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load slots");
      setSlots([]);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  // Each step's inputs unmount once you move past that step (only the
  // current step's JSX is rendered), so the browser's native `required`
  // validation never actually runs at final submit time - by then, only
  // step 4's read-only summary is in the DOM. This re-validates everything
  // for real, regardless of which step last touched it.
  const validateForm = () => {
    if (!form.patientName.trim()) return "Please enter the patient's name.";
    const ageNum = Number(form.age);
    if (!form.age || !Number.isFinite(ageNum) || ageNum <= 0) {
      return "Please enter a valid age.";
    }
    if (!form.phone.trim()) return "Please enter a phone number.";
    if (!form.symptoms.trim()) return "Please describe the symptoms.";
    if (!date || !form.slot) return "Please select a date and time slot.";
    return null;
  };

  const bookAppointment = async (e) => {
    e.preventDefault();

    const validationError = validateForm();
    if (validationError) {
      toast.warning(validationError);
      return;
    }

    try {
      setBooking(true);
      const res = await API.post("/appointments", {
        doctorId: id,
        patientName: form.patientName,
        age: Number(form.age),
        phone: form.phone,
        bloodGroup: form.bloodGroup,
        symptoms: form.symptoms,
        medicalConditions: form.medicalConditions,
        currentMedications: form.currentMedications,
        appointmentDate: date,
        slot: form.slot,
      });
      // Appointment no longer stores doctorName (see Appointment.js) - the
      // doctor doc is already loaded on this page, so enrich the receipt
      // view-model with it here rather than adding a backend lookup.
      navigate("/booking-success", {
        state: {
          ...res.data,
          appointment: {
            ...res.data.appointment,
            doctorName: doctor.name,
          },
        },
      });
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to book appointment");
    } finally {
      setBooking(false);
    }
  };

  const nextStep = () => {
    if (currentStep < 4) setCurrentStep(currentStep + 1);
  };

  const prevStep = () => {
    if (currentStep > 1) setCurrentStep(currentStep - 1);
  };

  const steps = [
    { number: 1, title: "Patient Details" },
    { number: 2, title: "Medical Details" },
    { number: 3, title: "Date & Slot" },
    { number: 4, title: "Confirmation" },
  ];

  const inputCls =
    "w-full px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors duration-150";
  const labelCls = "block text-sm font-medium text-gray-700 mb-2";
  const btnOutlineCls =
    "inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors duration-150 disabled:opacity-40 disabled:pointer-events-none";

  if (!doctor) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <PublicNav />
        <div className="px-4 sm:px-6 lg:px-8 py-24 flex items-center justify-center">
          <div className="text-center">
            <div className="w-8 h-8 border-[3px] border-gray-200 border-t-primary-600 rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-500">Loading doctor...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-12">
      <PublicNav />

      {/* Hero band */}
      <div className="bg-white border-b border-gray-200 px-4 sm:px-6 lg:px-8 py-10 mb-8">
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-primary-600 uppercase tracking-widest mb-2">
              Healthcare Excellence
            </p>
            <h1 className="text-3xl font-semibold text-gray-900 tracking-tight mb-1.5">
              Book an Appointment
            </h1>
            <p className="text-sm text-gray-500">
              Schedule your visit with {doctor.name} in a few quick steps.
            </p>
          </div>
          {branch?.phone && (
            <a
              href={`tel:${branch.phone.replace(/\s+/g, "")}`}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors duration-150 shrink-0"
            >
              <svg className="w-4 h-4 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
              </svg>
              Call {branch.phone}
            </a>
          )}
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Main Form */}
          <div className="lg:col-span-2">
            {/* Stepper */}
            <div className="bg-white border border-gray-200 p-5 sm:p-6 rounded-2xl mb-6">
              <div className="flex items-center justify-between">
                {steps.map((step) => (
                  <div key={step.number} className="flex items-center flex-1 last:flex-none">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-9 h-9 rounded-full flex items-center justify-center font-semibold text-sm border transition-colors duration-200 ${
                          currentStep > step.number
                            ? "bg-primary-600 border-primary-600 text-white"
                            : currentStep === step.number
                            ? "bg-white border-primary-600 text-primary-700 ring-4 ring-primary-50"
                            : "bg-white border-gray-300 text-gray-500"
                        }`}
                      >
                        {currentStep > step.number ? (
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        ) : (
                          step.number
                        )}
                      </div>
                      <span
                        className={`text-xs mt-2 font-medium hidden sm:block ${
                          currentStep >= step.number ? "text-gray-900" : "text-gray-500"
                        }`}
                      >
                        {step.title}
                      </span>
                    </div>
                    {step.number < 4 && (
                      <div className="flex-1 h-0.5 mx-2 bg-gray-200 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary-600 transition-[width] duration-300"
                          style={{ width: currentStep > step.number ? "100%" : "0%" }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Form Steps */}
            <form onSubmit={bookAppointment} className="bg-white border border-gray-200 p-6 sm:p-8 rounded-2xl">

              {/* Step 1: Patient Information */}
              {currentStep === 1 && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-6">Patient Details</h2>

                  <div>
                    <label htmlFor="patientName" className={labelCls}>
                      Full Name *
                    </label>
                    <input
                      id="patientName"
                      type="text"
                      name="patientName"
                      placeholder="Enter your full name"
                      required
                      value={form.patientName}
                      onChange={handleChange}
                      className={inputCls}
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label htmlFor="age" className={labelCls}>
                        Age *
                      </label>
                      <input
                        id="age"
                        type="number"
                        name="age"
                        placeholder="Enter your age"
                        required
                        min="1"
                        max="120"
                        value={form.age}
                        onChange={handleChange}
                        className={inputCls}
                      />
                    </div>

                    <div>
                      <label htmlFor="phone" className={labelCls}>
                        Phone Number *
                      </label>
                      <input
                        id="phone"
                        type="tel"
                        name="phone"
                        placeholder="Enter phone number"
                        required
                        value={form.phone}
                        onChange={handleChange}
                        className={inputCls}
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="bloodGroup" className={labelCls}>
                      Blood Group
                    </label>
                    <select
                      id="bloodGroup"
                      name="bloodGroup"
                      value={form.bloodGroup}
                      onChange={handleChange}
                      className={inputCls}
                    >
                      <option value="">Select blood group</option>
                      <option value="A+">A+</option>
                      <option value="A-">A-</option>
                      <option value="B+">B+</option>
                      <option value="B-">B-</option>
                      <option value="AB+">AB+</option>
                      <option value="AB-">AB-</option>
                      <option value="O+">O+</option>
                      <option value="O-">O-</option>
                    </select>
                  </div>

                  <div className="flex justify-end pt-4 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={nextStep}
                      disabled={!form.patientName.trim() || !(Number(form.age) > 0) || !form.phone.trim()}
                      className="btn-primary"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 2: Medical Information */}
              {currentStep === 2 && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-6">Medical Details</h2>

                  <div>
                    <label htmlFor="symptoms" className={labelCls}>
                      Symptoms *
                    </label>
                    <textarea
                      id="symptoms"
                      name="symptoms"
                      placeholder="Describe your symptoms"
                      required
                      rows={4}
                      value={form.symptoms}
                      onChange={handleChange}
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  <div>
                    <label htmlFor="medicalConditions" className={labelCls}>
                      Medical Conditions
                    </label>
                    <textarea
                      id="medicalConditions"
                      name="medicalConditions"
                      placeholder="Any existing medical conditions"
                      rows={3}
                      value={form.medicalConditions}
                      onChange={handleChange}
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  <div>
                    <label htmlFor="currentMedications" className={labelCls}>
                      Current Medications
                    </label>
                    <textarea
                      id="currentMedications"
                      name="currentMedications"
                      placeholder="Any medications you are currently taking"
                      rows={3}
                      value={form.currentMedications}
                      onChange={handleChange}
                      className={`${inputCls} resize-none`}
                    />
                  </div>

                  <div className="flex justify-between pt-4 border-t border-gray-100">
                    <button type="button" onClick={prevStep} className={btnOutlineCls}>
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={nextStep}
                      disabled={!form.symptoms}
                      className="btn-primary"
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* Step 3: Appointment Information */}
              {currentStep === 3 && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-6">Date & Slot</h2>

                  <div>
                    <label htmlFor="appointmentDate" className={labelCls}>
                      Select Date *
                    </label>
                    <input
                      id="appointmentDate"
                      type="date"
                      min={today}
                      value={date}
                      required
                      onChange={(e) => {
                        setDate(e.target.value);
                        setForm((prev) => ({ ...prev, slot: "" }));
                      }}
                      className={inputCls}
                    />
                  </div>

                  {date && (
                    <div>
                      <label className={`${labelCls} mb-3`}>Select Time Slot *</label>
                      {slots.length === 0 ? (
                        <div className="bg-gray-50 border border-gray-200 p-6 rounded-xl text-center">
                          <svg className="w-10 h-10 text-gray-500 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <p className="text-sm text-gray-500">No slots available for this date</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                          {slots.map((slot) => (
                            <button
                              key={slot}
                              type="button"
                              onClick={() => setForm({ ...form, slot })}
                              className={`px-3 py-2.5 rounded-lg text-sm font-medium border transition-colors duration-150 ${
                                form.slot === slot
                                  ? "border-primary-600 bg-primary-50 text-primary-700"
                                  : "border-gray-200 bg-white hover:border-primary-300 text-gray-700"
                              }`}
                            >
                              {slot}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex justify-between pt-4 border-t border-gray-100">
                    <button type="button" onClick={prevStep} className={btnOutlineCls}>
                      Back
                    </button>
                    <button
                      type="button"
                      onClick={nextStep}
                      disabled={!date || !form.slot}
                      className="btn-primary"
                    >
                      Review
                    </button>
                  </div>
                </div>
              )}

              {/* Step 4: Summary */}
              {currentStep === 4 && (
                <div className="space-y-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-6">Review & Confirm</h2>

                  <div className="space-y-4">
                    <div className="bg-gray-50 border border-gray-200 p-4 rounded-xl">
                      <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Patient Details</h3>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <span className="text-gray-500">Name:</span>
                          <p className="font-medium text-gray-900">{form.patientName}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Age:</span>
                          <p className="font-medium text-gray-900">{form.age}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Phone:</span>
                          <p className="font-medium text-gray-900">{form.phone}</p>
                        </div>
                        <div>
                          <span className="text-gray-500">Blood Group:</span>
                          <p className="font-medium text-gray-900">{form.bloodGroup || "Not specified"}</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-gray-50 border border-gray-200 p-4 rounded-xl">
                      <h3 className="text-xs font-semibold text-gray-500 mb-3 uppercase tracking-wide">Appointment Details</h3>
                      <div className="space-y-2 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-500">Doctor:</span>
                          <p className="font-medium text-gray-900">{doctor.name}</p>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Specialization:</span>
                          <p className="font-medium text-gray-900">{doctor.specialization}</p>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Date:</span>
                          <p className="font-medium text-gray-900">{date}</p>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Time:</span>
                          <p className="font-medium text-gray-900">{form.slot}</p>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Consultation Fee:</span>
                          <p className="font-semibold text-primary-700">₹{doctor.consultationFee}</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex justify-between pt-4 border-t border-gray-100">
                    <button type="button" onClick={prevStep} className={btnOutlineCls}>
                      Back
                    </button>
                    <button
                      type="submit"
                      disabled={booking}
                      className="btn-primary"
                    >
                      {booking ? (
                        <span className="flex items-center gap-2">
                          <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          Booking...
                        </span>
                      ) : (
                        "Confirm Booking"
                      )}
                    </button>
                  </div>
                </div>
              )}
            </form>
          </div>

          {/* Sidebar - Doctor Info */}
          <div className="lg:col-span-1">
            <div className="bg-white border border-gray-200 p-6 rounded-2xl sticky top-24">
              <div className="text-center mb-6">
                <DoctorAvatar name={doctor.name} size="lg" className="mx-auto mb-4" />
                <h3 className="text-base font-semibold text-gray-900 mb-1">{doctor.name}</h3>
                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-primary-50 text-primary-700">
                  {doctor.specialization}
                </span>
              </div>

              <div className="space-y-4 border-t border-gray-200 pt-6">
                <div className="flex items-center gap-3 text-sm">
                  <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="text-gray-600">{doctor.location}</span>
                </div>

                <div className="flex items-center gap-3 text-sm">
                  <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-gray-600">{doctor.experience} Years Experience</span>
                </div>

                <div className="flex items-center gap-3 text-sm">
                  <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <span className="text-gray-600">₹{doctor.consultationFee} / visit</span>
                </div>
              </div>

              <div className="mt-6 p-4 bg-primary-50 rounded-xl">
                <div className="flex items-center gap-2 mb-2">
                  <span className={`w-2 h-2 rounded-full ${doctor.isAvailable ? "bg-success-500" : "bg-gray-400"}`} />
                  <span className="text-sm font-medium text-gray-800">
                    {doctor.isAvailable ? "Available Today" : "Currently Unavailable"}
                  </span>
                </div>
                <p className="text-xs text-gray-500">
                  Book your appointment now to secure your slot
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BookAppointment;
