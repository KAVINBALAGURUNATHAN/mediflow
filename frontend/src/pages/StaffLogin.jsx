import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Stethoscope,
  Headset,
  FirstAid,
  Flask,
  UsersThree,
} from "@phosphor-icons/react";

// The staff entry point, reached from the public footer or by typing
// /staff-login directly.
//
// This is NOT a login form and NOT a second authentication system. Each role
// keeps its own login page, its own credentials and its own backend
// middleware exactly as before; this page only chooses between them. It
// exists because "Staff Login" was previously a dropdown in the patient-facing
// header, which advertised internal systems to every visitor browsing for a
// doctor. Demoting it needed somewhere for the footer link to land.
//
// EVERY staff role must be listed here. The nurse login existed for a whole
// phase reachable only by typing /nurse-login from memory, because the old
// header dropdown was never updated when the role landed. Adding a role means
// adding it here and to Sidebar.jsx's routeRole map.
const ROLES = [
  {
    label: "Doctor",
    to: "/doctor-login",
    description: "Consultations, queue and clinical records",
    Icon: Stethoscope,
  },
  {
    label: "Reception",
    to: "/receptionist-login",
    description: "Check-in, queue and appointments",
    Icon: Headset,
  },
  {
    label: "Nurse",
    to: "/nurse-login",
    description: "Vitals and clinical preparation",
    Icon: FirstAid,
  },
  {
    label: "Lab Technician",
    to: "/lab-technician-login",
    description: "The laboratory worklist and results",
    Icon: Flask,
  },
  {
    label: "Administrator",
    to: "/admin-login",
    description: "Doctors, staff, branches and the lab catalog",
    Icon: UsersThree,
  },
];

function StaffLogin() {
  const navigate = useNavigate();

  return (
    <div className="min-h-[100dvh] bg-[#F8FAFC] flex flex-col">
      <main className="flex-1 flex items-center justify-center px-5 py-12">
        <div className="w-full max-w-lg">
          <Link
            to="/"
            className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-500 hover:text-gray-700 transition-colors mb-6"
          >
            <ArrowLeft weight="bold" className="w-4 h-4" aria-hidden="true" />
            Back to MediFlow website
          </Link>

          <h1 className="text-[28px] sm:text-[32px] font-bold text-[#111827] tracking-tight">
            Staff Login
          </h1>
          <p className="text-sm text-[#6B7280] mt-2 mb-7">
            Choose your role to sign in. Access is restricted to authorised
            hospital staff.
          </p>

          <div className="space-y-3">
            {ROLES.map(({ label, to, description, Icon }) => (
              <button
                key={to}
                type="button"
                onClick={() => navigate(to)}
                className="w-full flex items-center gap-4 text-left bg-white rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04)] px-5 py-4 hover:border-primary-300 hover:shadow-[0_8px_24px_-12px_rgba(15,23,42,0.18)] active:scale-[0.995] transition duration-150"
              >
                <span className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center shrink-0">
                  <Icon weight="duotone" className="w-5 h-5" aria-hidden="true" />
                </span>

                <span className="min-w-0">
                  <span className="block text-[15px] font-semibold text-[#111827]">
                    {label}
                  </span>
                  <span className="block text-[13px] text-[#6B7280]">
                    {description}
                  </span>
                </span>
              </button>
            ))}
          </div>

          <p className="text-xs text-gray-500 mt-7">
            Looking for your own appointments, prescriptions or lab results?{" "}
            <Link
              to="/patient-login"
              className="font-medium text-primary-600 hover:text-primary-700"
            >
              Go to the Patient Portal
            </Link>
            .
          </p>
        </div>
      </main>

      <footer className="border-t border-slate-200">
        <div className="max-w-lg mx-auto px-5 py-5">
          <p className="text-[11px] text-gray-500">
            © {new Date().getFullYear()} MediFlow · Staff Portal
          </p>
        </div>
      </footer>
    </div>
  );
}

export default StaffLogin;
