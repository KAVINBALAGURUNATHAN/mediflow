import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import PublicNav from "../components/PublicNav";

// Public/patient-facing confirmation page - deliberately forced to a light
// theme (no `dark:` classes anywhere in this file), matching the rest of
// the patient discovery/booking surface (Doctors.jsx, BookAppointment.jsx).
function BookingSuccess() {
  const location = useLocation();
  const navigate = useNavigate();
  const [isBouncing, setIsBouncing] = useState(true);

  useEffect(() => {
    // animate-bounce is a 1s keyframe - two iterations reads as a
    // deliberate "ta-da" rather than a nervous infinite tic.
    const timer = setTimeout(() => setIsBouncing(false), 2000);
    return () => clearTimeout(timer);
  }, []);

  const data = location.state;

  if (!data) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <PublicNav />
        <div className="px-4 sm:px-6 lg:px-8 py-24 flex items-center justify-center">
          <div className="bg-white border border-gray-200 p-8 rounded-2xl text-center max-w-md">
          <svg className="w-12 h-12 text-gray-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              No booking information found
            </h2>
            <button onClick={() => navigate("/")} className="btn-primary">
              Go Home
            </button>
          </div>
        </div>
      </div>
    );
  }

  const appointment = data.appointment;

  const downloadReceipt = () => {
    const receiptContent = `
MEDIFLOW - APPOINTMENT RECEIPT
================================

Booking ID: ${appointment.bookingId || 'N/A'}
Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}

APPOINTMENT DETAILS
------------------
Doctor: ${appointment.doctorName}
Patient: ${appointment.patientName}
Appointment Date: ${new Date(appointment.appointmentDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })}
Time Slot: ${appointment.slot}
Phone: ${appointment.phone}

Thank you for choosing MediFlow!
    `.trim();

    const blob = new Blob([receiptContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `receipt_${appointment.bookingId || 'appointment'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <PublicNav />

      <div className="px-4 sm:px-6 lg:px-8 py-12 flex items-center justify-center">
        <div className="max-w-lg w-full">
        {/* Confirmation header */}
        <div className="bg-white border border-gray-200 p-8 sm:p-10 rounded-2xl text-center mb-6">
          <div className={`inline-flex items-center justify-center w-16 h-16 bg-success-600 rounded-full mb-6 ${isBouncing ? "animate-bounce" : ""}`}>
            <svg className="w-8 h-8 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>

          <h1 className="text-xl sm:text-2xl font-semibold text-gray-900 mb-2">
            Appointment Booked
          </h1>
          <p className="text-sm text-gray-500">
            Your appointment has been confirmed. Details are below.
          </p>
        </div>

        {/* Appointment Summary Card */}
        <div className="bg-white border border-gray-200 p-6 sm:p-8 rounded-2xl mb-6">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-6">Appointment Summary</h2>

          <div className="space-y-0 divide-y divide-gray-100">
            {appointment.bookingId && (
              <div className="flex justify-between items-center py-3">
                <span className="text-sm text-gray-500">Booking ID</span>
                <span className="font-mono text-sm font-semibold text-primary-700">
                  {appointment.bookingId}
                </span>
              </div>
            )}

            <div className="flex justify-between items-center py-3">
              <span className="text-sm text-gray-500">Doctor</span>
              <span className="font-medium text-gray-900">{appointment.doctorName}</span>
            </div>

            <div className="flex justify-between items-center py-3">
              <span className="text-sm text-gray-500">Patient</span>
              <span className="font-medium text-gray-900">{appointment.patientName}</span>
            </div>

            <div className="flex justify-between items-center py-3">
              <span className="text-sm text-gray-500">Date</span>
              <span className="font-medium text-gray-900">
                {new Date(appointment.appointmentDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "long",
                  year: "numeric",
                })}
              </span>
            </div>

            <div className="flex justify-between items-center py-3">
              <span className="text-sm text-gray-500">Time Slot</span>
              <span className="font-medium text-gray-900">{appointment.slot}</span>
            </div>

            <div className="flex justify-between items-center py-3">
              <span className="text-sm text-gray-500">Phone</span>
              <span className="font-medium text-gray-900">{appointment.phone}</span>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-3">
          <button
            onClick={downloadReceipt}
            className="inline-flex items-center justify-center gap-2 px-4 py-2.5 w-full bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors duration-150"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Receipt
          </button>

          {appointment.tokenNumber ? (
            // Only reachable once checked in - tokens are assigned at
            // check-in, not at booking, and the waiting room needs both
            // doctorId and tokenNumber (tokens are unique per doctor, not
            // clinic-wide).
            <Link to={`/waiting-room/${appointment.doctorId}/${appointment.tokenNumber}`} className="block">
              <button className="btn-primary w-full">
                <span className="flex items-center justify-center gap-2">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                  Go to Waiting Room
                </span>
              </button>
            </Link>
          ) : (
            <div className="text-center text-sm text-gray-500 px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl">
              You'll get a queue token when you check in at the clinic on your appointment date.
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Link to="/doctors">
              <button className="inline-flex items-center justify-center gap-2 px-4 py-2.5 w-full bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors duration-150">
                Book Another
              </button>
            </Link>

            <button
              onClick={() => navigate("/")}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 w-full bg-white text-gray-700 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors duration-150"
            >
              Home
            </button>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-primary-50 rounded-xl">
          <div className="flex items-start gap-3">
            <svg className="w-5 h-5 text-primary-600 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-sm text-gray-600">
              Please arrive 15 minutes before your appointment time. Bring your ID and any relevant medical documents.
            </p>
          </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default BookingSuccess;
