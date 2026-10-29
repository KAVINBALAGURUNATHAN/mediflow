import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";

import Header from "./components/Header";
import Sidebar from "./components/Sidebar";
import NetworkStatus from "./components/NetworkStatus";
import DoctorProtectedRoute from "./components/DoctorProtectedRoute"; // Clarified name from ProtectedRoute
import ReceptionistProtectedRoute from "./components/ReceptionistProtectedRoute";
import NurseProtectedRoute from "./components/NurseProtectedRoute";
import LabTechnicianProtectedRoute from "./components/LabTechnicianProtectedRoute";
import AdminProtectedRoute from "./components/AdminProtectedRoute";
import PatientProtectedRoute from "./components/PatientProtectedRoute";

// Public Pages
import Home from "./pages/Home";
import Departments from "./pages/Departments";
import HealthPackages from "./pages/HealthPackages";
import Emergency from "./pages/Emergency";
import Contact from "./pages/Contact";
import FindBranch from "./pages/FindBranch";
import Doctors from "./pages/Doctors";
import DoctorPublicProfile from "./pages/DoctorPublicProfile";
import BookAppointment from "./pages/BookAppointment";
import BookingSuccess from "./pages/BookingSuccess";
import PatientWaitingRoom from "./pages/PatientWaitingRoom";
import MyAppointments from "./pages/MyAppointments";
import LiveQueueBoard from "./pages/LiveQueueBoard";
import NotFound from "./pages/NotFound";

// Doctor Pages
import DoctorLogin from "./pages/DoctorLogin";
import DoctorDashboard from "./pages/DoctorDashboard";
import DoctorProfile from "./pages/DoctorProfile";
import Appointments from "./pages/Appointments";
import AppointmentDetails from "./pages/AppointmentDetails";
import Analytics from "./pages/Analytics";
import PatientHistory from "./pages/PatientHistory";
import Settings from "./pages/Settings";

// Receptionist Pages
import ReceptionistLogin from "./pages/ReceptionistLogin";
import ReceptionistDashboard from "./pages/ReceptionistDashboard";

// Nurse Pages
import NurseLogin from "./pages/NurseLogin";
import NurseDashboard from "./pages/NurseDashboard";

// Lab Technician Pages
import LabTechnicianLogin from "./pages/LabTechnicianLogin";
import LabTechnicianDashboard from "./pages/LabTechnicianDashboard";

// Patient Account Pages
import PatientRegister from "./pages/PatientRegister";
import PatientLogin from "./pages/PatientLogin";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import PatientDashboard from "./pages/PatientDashboard";
import PatientProfile from "./pages/PatientProfile";
import PatientMedicalReports from "./pages/PatientMedicalReports";
import PatientPrescriptions from "./pages/PatientPrescriptions";
import PatientLabResults from "./pages/PatientLabResults";
import PatientAppointmentDetail from "./pages/PatientAppointmentDetail";

// Admin Pages
import AdminLogin from "./pages/AdminLogin";

// Staff entry point (role chooser, not a login form of its own)
import StaffLogin from "./pages/StaffLogin";
import AdminDashboard from "./pages/AdminDashboard";
import AddDoctor from "./pages/AddDoctor";
import AdminPatients from "./pages/AdminPatients";
import AdminLabTests from "./pages/AdminLabTests";

// Inside <BrowserRouter> (unlike App itself) so it can call useLocation().
// The Sidebar/Header chrome is for the internal Doctor/Receptionist/Admin
// experience; public patient pages render their own PublicNav instead.
function AppShell({ appRoutes }) {
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isPublicPatientPage =
    location.pathname === "/" ||
    location.pathname === "/departments" ||
    location.pathname === "/health-packages" ||
    location.pathname === "/emergency" ||
    location.pathname === "/contact" ||
    location.pathname === "/find-branch" ||
    location.pathname === "/doctors" ||
    location.pathname.startsWith("/doctors/") ||
    // The booking flow continues Find a Doctor, so it keeps the same chrome.
    // Without these two the shell swapped the public header for the
    // Sidebar/Header dashboard chrome halfway through Doctors -> Book ->
    // Confirmed, which is why the navigation appeared to change mid-flow.
    // BookingSuccess.jsx already documented itself as part of "the patient
    // discovery/booking surface (Doctors.jsx, BookAppointment.jsx)" - this is
    // the shell finally agreeing with that.
    location.pathname.startsWith("/book/") ||
    location.pathname === "/booking-success" ||
    location.pathname === "/patient-login" ||
    location.pathname === "/patient-register" ||
    location.pathname === "/doctor-login" ||
    location.pathname === "/receptionist-login" ||
    location.pathname === "/nurse-login" ||
    location.pathname === "/lab-technician-login" ||
    location.pathname === "/staff-login" ||
    location.pathname === "/admin-login" ||
    location.pathname === "/forgot-password" ||
    location.pathname === "/reset-password" ||
    location.pathname === "/doctor-forgot-password" ||
    location.pathname === "/doctor-reset-password";

  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  return (
    <div className="app-gradient min-h-screen flex transition-colors duration-200">
      <NetworkStatus />

      {!isPublicPatientPage && (
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      )}

      <div className={`flex-1 flex flex-col min-w-0 ${!isPublicPatientPage ? "md:pl-64" : ""}`}>
        {/* Home.jsx/Doctors.jsx/DoctorPublicProfile.jsx each render their
            own PublicNav - the dashboard Header would otherwise duplicate
            it above it. */}
        {!isPublicPatientPage && <Header onMenuClick={() => setSidebarOpen(true)} />}

        <main className="flex-1 relative z-10">
          <Routes>
            {appRoutes.map(({ path, element, guard: Guard }) => (
              <Route
                key={path}
                path={path}
                element={Guard ? <Guard>{element}</Guard> : element}
              />
            ))}
          </Routes>
        </main>
      </div>
    </div>
  );
}

function App() {
  const appRoutes = [
    // === Public Routes ===
    // Browsing doctors is open; booking, history, records, and profile all
    // require a patient login (PatientProtectedRoute bounces to /patient-login).
    { path: "/", element: <Home /> },
    { path: "/departments", element: <Departments /> },
    { path: "/health-packages", element: <HealthPackages /> },
    { path: "/emergency", element: <Emergency /> },
    { path: "/contact", element: <Contact /> },
    { path: "/find-branch", element: <FindBranch /> },
    { path: "/doctors", element: <Doctors /> },
    { path: "/doctors/:id", element: <DoctorPublicProfile /> },
    { path: "/booking-success", element: <BookingSuccess /> },
    { path: "/live-queue", element: <LiveQueueBoard />, guard: ReceptionistProtectedRoute },

    // === Protected Patient Routes ===
    { path: "/book/:id", element: <BookAppointment />, guard: PatientProtectedRoute },
    { path: "/my-appointments", element: <MyAppointments />, guard: PatientProtectedRoute },
    { path: "/medical-reports", element: <PatientMedicalReports />, guard: PatientProtectedRoute },
    { path: "/prescriptions", element: <PatientPrescriptions />, guard: PatientProtectedRoute },
    { path: "/lab-results", element: <PatientLabResults />, guard: PatientProtectedRoute },
    { path: "/profile", element: <PatientProfile />, guard: PatientProtectedRoute },
    { path: "/appointment/:id", element: <PatientAppointmentDetail />, guard: PatientProtectedRoute },
    // Backend requires doctorId + tokenNumber together, since token
    // numbers are only unique per doctor per day, not clinic-wide.
    { path: "/waiting-room/:doctorId/:tokenNumber", element: <PatientWaitingRoom />, guard: PatientProtectedRoute },

    // === Doctor Routes ===
    { path: "/doctor-login", element: <DoctorLogin /> },
    { path: "/dashboard", element: <DoctorDashboard />, guard: DoctorProtectedRoute },
    { path: "/doctor/profile", element: <DoctorProfile />, guard: DoctorProtectedRoute },
    { path: "/appointments", element: <Appointments />, guard: DoctorProtectedRoute },
    { path: "/appointments/:id", element: <AppointmentDetails />, guard: DoctorProtectedRoute },
    { path: "/analytics", element: <Analytics />, guard: DoctorProtectedRoute },
    { path: "/patient-history/:phone", element: <PatientHistory />, guard: DoctorProtectedRoute },
    { path: "/settings", element: <Settings />, guard: DoctorProtectedRoute },

    // === Receptionist Routes ===
    { path: "/staff-login", element: <StaffLogin /> },
    { path: "/receptionist-login", element: <ReceptionistLogin /> },
    { path: "/receptionist", element: <ReceptionistDashboard />, guard: ReceptionistProtectedRoute },

    // === Nurse Routes ===
    { path: "/nurse-login", element: <NurseLogin /> },
    { path: "/nurse", element: <NurseDashboard />, guard: NurseProtectedRoute },

    // === Lab Technician Routes ===
    { path: "/lab-technician-login", element: <LabTechnicianLogin /> },
    { path: "/lab-technician", element: <LabTechnicianDashboard />, guard: LabTechnicianProtectedRoute },

    // === Patient Account Routes ===
    { path: "/patient-register", element: <PatientRegister /> },
    { path: "/patient-login", element: <PatientLogin /> },
    { path: "/forgot-password", element: <ForgotPassword role="patient" /> },
    { path: "/reset-password", element: <ResetPassword role="patient" /> },
    { path: "/doctor-forgot-password", element: <ForgotPassword role="doctor" /> },
    { path: "/doctor-reset-password", element: <ResetPassword role="doctor" /> },
    { path: "/patient-dashboard", element: <PatientDashboard />, guard: PatientProtectedRoute },

    // === Admin Routes ===
    { path: "/admin-login", element: <AdminLogin /> },
    { path: "/admin-dashboard", element: <AdminDashboard />, guard: AdminProtectedRoute },
    { path: "/admin/add-doctor", element: <AddDoctor />, guard: AdminProtectedRoute },
    { path: "/admin/patients", element: <AdminPatients />, guard: AdminProtectedRoute },
    { path: "/admin/lab-tests", element: <AdminLabTests />, guard: AdminProtectedRoute },

    // === Fallback ===
    { path: "*", element: <NotFound /> }
  ];

  return (
    <BrowserRouter>
      <AppShell appRoutes={appRoutes} />
    </BrowserRouter>
  );
}

export default App;