import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import {
  Prescription,
  Flask,
  SquaresFour,
  CalendarBlank,
  SignIn,
  SignOut,
  ListChecks,
  Stethoscope,
  ChartBar,
  Gear,
  UsersThree,
} from '@phosphor-icons/react';
import { useToast } from '../context/ToastContext';
import ConfirmModal from './ConfirmModal';
import BrandMark from './BrandMark';

const DashboardIcon = () => <SquaresFour weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const AppointmentIcon = () => <CalendarBlank weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const LoginIcon = () => <SignIn weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const LiveQueueIcon = () => <ListChecks weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const FindDoctorIcon = () => <Stethoscope weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const AnalyticsIcon = () => <ChartBar weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const SettingsIcon = () => <Gear weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const AdminIcon = () => <UsersThree weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const PrescriptionIcon = () => <Prescription weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const LabResultIcon = () => <Flask weight="duotone" className="w-5 h-5" aria-hidden="true" />;
const LogoutIcon = () => <SignOut weight="duotone" className="w-4 h-4" aria-hidden="true" />;

// Colored-initials avatar - no photo data exists anywhere in the backend
// (Doctor/Admin/Receptionist models have no avatar field), so this is an
// honest placeholder rather than a fake photo.
function InitialsAvatar({ name, tone }) {
  const initial = (name || '?').trim().charAt(0).toUpperCase();
  const tones = {
    teal: 'bg-primary-50 text-primary-600 dark:bg-primary-500/10 dark:text-primary-300',
    violet: 'bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10 dark:text-secondary-300',
    accent: 'bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-300',
  };
  return (
    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shrink-0 ${tones[tone] || tones.teal}`}>
      {initial}
    </div>
  );
}

function NavItem({ to, icon, label, onNavigate }) {
  return (
    <NavLink
      to={to}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 h-11 px-3.5 rounded-xl text-sm font-semibold transition duration-150 ${
          isActive
            ? 'bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/[0.04]'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

const Sidebar = ({ isOpen, onClose }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const [confirmModal, setConfirmModal] = useState(null);

  const doctorToken = localStorage.getItem('doctorToken');
  const adminToken = localStorage.getItem('adminToken');
  const nurseToken = localStorage.getItem('nurseToken');
  const labTechnicianToken = localStorage.getItem('labTechnicianToken');
  const receptionistToken = localStorage.getItem('receptionistToken');
  const patientToken = localStorage.getItem('patientToken');

  const hasDoctorToken = !!doctorToken;
  const hasAdminToken = !!adminToken;
  const hasNurseToken = !!nurseToken;
  const hasLabTechnicianToken = !!labTechnicianToken;
  const hasReceptionistToken = !!receptionistToken;
  const hasPatientToken = !!patientToken;
  // Every staff token counts. Nurse and lab technician were missing here when
  // their roles were added, which hid the profile block AND the Log out button
  // from both of them - the only way out was clearing localStorage by hand.
  // Adding a role means adding it to this list, to routeRole above, and to
  // StaffLogin.jsx.
  const isLoggedIn =
    hasDoctorToken ||
    hasAdminToken ||
    hasReceptionistToken ||
    hasNurseToken ||
    hasLabTechnicianToken ||
    hasPatientToken;

  // This app allows a doctor/admin/receptionist/patient token to all sit in
  // localStorage at once (e.g. one browser used to test multiple roles, or
  // a staff token left over from a previous session that was never
  // explicitly logged out of). Picking the nav purely by "which token
  // exists" is unreliable once more than one does - it previously showed
  // the DOCTOR nav (Dashboard/Appointments/Analytics/Settings) on the
  // Receptionist Dashboard whenever a leftover doctorToken outranked
  // receptionistToken in the old if/else chain. Each dashboard route is
  // already guarded by its own role-specific ProtectedRoute (see App.jsx),
  // which guarantees the matching token really is present for THAT route -
  // so the current URL is the reliable signal for "which role's nav should
  // show", not token precedence. Token-based flags remain as a fallback
  // for pages with no route-role mapping (e.g. a role's own login page).
  const routeRole = (() => {
    const p = location.pathname;
    if (p === '/admin-dashboard' || p === '/admin/add-doctor') return 'admin';
    if (p === '/receptionist' || p === '/live-queue') return 'receptionist';
    if (p === '/nurse') return 'nurse';
    if (p === '/lab-technician') return 'labTechnician';
    if (
      p === '/dashboard' ||
      p === '/doctor/profile' ||
      p === '/appointments' ||
      p.startsWith('/appointments/') ||
      p === '/analytics' ||
      p.startsWith('/patient-history/') ||
      p === '/settings'
    ) return 'doctor';
    if (
      p === '/patient-dashboard' ||
      p === '/my-appointments' ||
      p === '/medical-reports' ||
      p === '/prescriptions' ||
      p === '/lab-results' ||
      p === '/profile' ||
      p.startsWith('/appointment/') ||
      p.startsWith('/waiting-room/') ||
      p.startsWith('/book/')
    ) return 'patient';
    return null;
  })();

  const isAdmin = routeRole ? routeRole === 'admin' : hasAdminToken;
  const isDoctor = routeRole ? routeRole === 'doctor' : hasDoctorToken;
  const isReceptionist = routeRole ? routeRole === 'receptionist' : hasReceptionistToken;
  const isPatient = routeRole ? routeRole === 'patient' : hasPatientToken;
  const isNurse = routeRole ? routeRole === 'nurse' : hasNurseToken;
  const isLabTechnician = routeRole
    ? routeRole === 'labTechnician'
    : hasLabTechnicianToken;

  const doctor = (() => {
    try { return JSON.parse(localStorage.getItem('doctor')); } catch { return null; }
  })();
  const admin = (() => {
    try { return JSON.parse(localStorage.getItem('admin')); } catch { return null; }
  })();
  const receptionist = (() => {
    try { return JSON.parse(localStorage.getItem('receptionist')); } catch { return null; }
  })();
  const patient = (() => {
    try { return JSON.parse(localStorage.getItem('patient')); } catch { return null; }
  })();

  const nurse = (() => {
    try { return JSON.parse(localStorage.getItem('nurse')); } catch { return null; }
  })();

  const labTechnician = (() => {
    try { return JSON.parse(localStorage.getItem('labTechnician')); } catch { return null; }
  })();

  const displayName = isAdmin
    ? admin?.email?.split('@')[0] || 'Admin'
    : isReceptionist
      ? receptionist?.name || 'Receptionist'
      : isNurse
        ? nurse?.name || 'Nurse'
        : isLabTechnician
          ? labTechnician?.name || 'Lab Technician'
          : isPatient
          ? patient?.name || 'Patient'
          : doctor?.name || 'Doctor';

  const displayRole = isAdmin
    ? 'Admin'
    : isReceptionist
      ? 'Receptionist'
      : isNurse
        ? 'Nurse'
        : isLabTechnician
          ? 'Lab Technician'
          : isPatient
            ? 'Patient'
            : 'Doctor';
  const avatarTone = isAdmin ? 'violet' : isReceptionist ? 'accent' : isPatient ? 'teal' : 'teal';

  // The staff role chooser renders its own chrome (see StaffLogin.jsx), so
  // the sidebar must not also appear there.
  const isHomePage = location.pathname === '/';
  const isDoctorLoginPage = location.pathname === '/doctor-login';
  const isAdminLoginPage = location.pathname === '/admin-login';
  const isReceptionistLoginPage = location.pathname === '/receptionist-login';
  const isNurseLoginPage = location.pathname === '/nurse-login';
  const isLabTechnicianLoginPage =
    location.pathname === '/lab-technician-login';
  const isPatientLoginPage = location.pathname === '/patient-login' || location.pathname === '/patient-register';
  const isPatientFlow =
    location.pathname === '/doctors' ||
    location.pathname.startsWith('/book/') ||
    location.pathname === '/booking-success' ||
    location.pathname === '/my-appointments' ||
    location.pathname.startsWith('/waiting-room/');

  const handleLogout = () => {
    setConfirmModal({
      title: 'Log out of MediFlow?',
      message: `You will be signed out of the ${displayRole} portal.`,
      variant: 'warning',
      confirmLabel: 'Log out',
      onConfirm: () => {
        const redirectPath = isAdmin
          ? '/admin-login'
          : isReceptionist
            ? '/receptionist-login'
            : isNurse
              ? '/nurse-login'
              : isLabTechnician
                ? '/lab-technician-login'
                : isPatient
                ? '/patient-login'
                : '/doctor-login';

        // Only clear the role that's actually logging out. This app lets
        // a doctor/receptionist/admin/patient token all coexist in the same
        // browser's localStorage (e.g. testing multiple roles, or a shared
        // reception desk machine also used to check a patient's own
        // bookings) - unconditionally wiping all four here meant logging
        // out of ANY one role silently logged every other role out too.
        if (isAdmin) {
          localStorage.removeItem('adminToken');
          localStorage.removeItem('admin');
        } else if (isReceptionist) {
          localStorage.removeItem('receptionistToken');
          localStorage.removeItem('receptionist');
        } else if (isNurse) {
          localStorage.removeItem('nurseToken');
          localStorage.removeItem('nurse');
        } else if (isLabTechnician) {
          localStorage.removeItem('labTechnicianToken');
          localStorage.removeItem('labTechnician');
        } else if (isPatient) {
          localStorage.removeItem('patientToken');
          localStorage.removeItem('patient');
        } else {
          localStorage.removeItem('doctorToken');
          localStorage.removeItem('doctor');
        }

        toast.info('You have been logged out.');
        navigate(redirectPath);
        onClose?.();
      },
    });
  };

  if (isHomePage) return null;

  const renderNav = () => {
    if (isAdmin) {
      return <NavItem to="/admin-dashboard" icon={<AdminIcon />} label="Admin Dashboard" onNavigate={onClose} />;
    }

    if (isDoctor) {
      return (
        <>
          <NavItem to="/dashboard" icon={<DashboardIcon />} label="Dashboard" onNavigate={onClose} />
          <NavItem to="/appointments" icon={<AppointmentIcon />} label="Appointments" onNavigate={onClose} />
          <NavItem to="/analytics" icon={<AnalyticsIcon />} label="Analytics" onNavigate={onClose} />
          <NavItem to="/doctor/profile" icon={<SettingsIcon />} label="Profile" onNavigate={onClose} />
          <NavItem to="/settings" icon={<SettingsIcon />} label="Settings" onNavigate={onClose} />
        </>
      );
    }

    if (isReceptionist) {
      return (
        <>
          <NavItem to="/receptionist" icon={<DashboardIcon />} label="Reception Dashboard" onNavigate={onClose} />
          <NavItem to="/live-queue" icon={<LiveQueueIcon />} label="Live Queue Board" onNavigate={onClose} />
        </>
      );
    }

    if (isLabTechnician) {
      return (
        <NavItem
          to="/lab-technician"
          icon={<LabResultIcon />}
          label="Laboratory Worklist"
          onNavigate={onClose}
        />
      );
    }

    if (isNurse) {
      return (
        <NavItem
          to="/nurse"
          icon={<DashboardIcon />}
          label="Clinical Preparation"
          onNavigate={onClose}
        />
      );
    }

    if (isPatient) {
      return (
        <>
          <NavItem to="/patient-dashboard" icon={<DashboardIcon />} label="Dashboard" onNavigate={onClose} />
          <NavItem to="/doctors" icon={<FindDoctorIcon />} label="Book Appointment" onNavigate={onClose} />
          <NavItem to="/my-appointments" icon={<AppointmentIcon />} label="My Appointments" onNavigate={onClose} />
          <NavItem to="/medical-reports" icon={<AnalyticsIcon />} label="Medical Reports" onNavigate={onClose} />
          <NavItem to="/prescriptions" icon={<PrescriptionIcon />} label="Prescriptions" onNavigate={onClose} />
          <NavItem to="/lab-results" icon={<LabResultIcon />} label="Lab Results" onNavigate={onClose} />
          <NavItem to="/health-packages" icon={<LiveQueueIcon />} label="Health Packages" onNavigate={onClose} />
          <NavItem to="/profile" icon={<SettingsIcon />} label="Profile" onNavigate={onClose} />
        </>
      );
    }

    if (isDoctorLoginPage) {
      return <NavItem to="/doctor-login" icon={<LoginIcon />} label="Doctor Login" onNavigate={onClose} />;
    }

    if (isAdminLoginPage) {
      return <NavItem to="/admin-login" icon={<LoginIcon />} label="Admin Login" onNavigate={onClose} />;
    }

    if (isReceptionistLoginPage) {
      return <NavItem to="/receptionist-login" icon={<LoginIcon />} label="Receptionist Login" onNavigate={onClose} />;
    }

    if (isNurseLoginPage) {
      return <NavItem to="/nurse-login" icon={<LoginIcon />} label="Nurse Login" onNavigate={onClose} />;
    }

    if (isLabTechnicianLoginPage) {
      return <NavItem to="/lab-technician-login" icon={<LoginIcon />} label="Lab Technician Login" onNavigate={onClose} />;
    }

    // Shared logged-out patient nav: Find Doctors + a single combined
    // Sign In / Register entry (PatientAuth.jsx) - not two separate
    // buttons that both lead to patient auth.
    // My Appointments/Medical Reports/Profile are deliberately absent here -
    // they're all protected routes now, so showing them to a guest would
    // just bounce them straight to /patient-login anyway.
    const loggedOutPatientNav = (
      <>
        <NavItem to="/doctors" icon={<FindDoctorIcon />} label="Find Doctors" onNavigate={onClose} />
        <NavItem to="/patient-login" icon={<AppointmentIcon />} label="Sign In / Register" onNavigate={onClose} />
      </>
    );

    if (isPatientLoginPage) {
      return loggedOutPatientNav;
    }

    if (isPatientFlow) {
      return loggedOutPatientNav;
    }

    // Public fallback (e.g. 404). Staff get one low-key entry to the role
    // chooser rather than a Doctor Login link, which both implied doctors
    // were the only staff and duplicated what the footer already offers.
    return (
      <>
        {loggedOutPatientNav}
        <NavItem to="/staff-login" icon={<LoginIcon />} label="Staff Login" onNavigate={onClose} />
      </>
    );
  };

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-slate-900/50 md:hidden transition duration-200 ease-out ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 flex flex-col bg-white dark:bg-surface-card
          border-r border-slate-200 dark:border-surface-border transition duration-200 ease-out
          md:translate-x-0 ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}
        aria-label="Primary navigation"
      >
        {/* Logo */}
        <Link to={isAdmin ? '/admin-dashboard' : isDoctor ? '/dashboard' : isReceptionist ? '/receptionist' : isPatient ? '/patient-dashboard' : '/'}
          className="flex items-center gap-3 px-5 h-16 shrink-0 border-b border-slate-200 dark:border-surface-border group"
          onClick={onClose}
        >
          <BrandMark className="w-9 h-9 shrink-0 group-hover-scale-105 transition duration-200" />
          <div className="min-w-0">
            <span className="font-bold text-slate-900 dark:text-white text-sm tracking-tight block leading-tight truncate">
              MediFlow
            </span>
            <span className="text-[10px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em]">
              Digital Appointment Platform
            </span>
          </div>
        </Link>


        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1" aria-label="Main navigation">
          {renderNav()}
        </nav>

        {/* Profile / logout */}
        {isLoggedIn && (
          <div className="shrink-0 border-t border-slate-200 dark:border-surface-border p-3">
            <div className="flex items-center gap-3 px-2 py-2">
              <InitialsAvatar name={displayName} tone={avatarTone} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{displayName}</p>
                {/* Patients get their hospital ID here - it's what reception
                    and every printed report reference. */}
                {isPatient && patient?.patientId ? (
                  <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400 truncate">
                    {patient.patientId}
                  </p>
                ) : (
                  <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">{displayRole}</p>
                )}
              </div>
            </div>
            {/* Full-width labelled button rather than a small icon - logging
                out was previously easy to miss. */}
            <button
              type="button"
              onClick={handleLogout}
              className="mt-1 w-full flex items-center gap-3 h-11 px-3.5 rounded-xl text-sm font-semibold text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-500/10 active:scale-[0.98] transition duration-150"
            >
              <LogoutIcon />
              Log out
            </button>
          </div>
        )}
      </aside>

      <ConfirmModal config={confirmModal} onClose={() => setConfirmModal(null)} />
    </>
  );
};

export default Sidebar;
