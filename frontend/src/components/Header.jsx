import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { List, Bell, Heart } from '@phosphor-icons/react';

// Breadcrumb labels for the app's actual routes (see src/App.jsx's
// appRoutes). Matched by simple prefix test since most routes here are
// flat (one dynamic segment at most), not deeply nested.
const ROUTE_LABELS = [
  { test: (p) => p === '/doctors', label: 'Find Doctors' },
  { test: (p) => p.startsWith('/doctors/'), label: 'Doctor Profile' },
  { test: (p) => p.startsWith('/book/'), label: 'Book Appointment' },
  { test: (p) => p === '/booking-success', label: 'Booking Confirmed' },
  { test: (p) => p === '/my-appointments', label: 'My Appointments' },
  { test: (p) => p.startsWith('/waiting-room/'), label: 'Waiting Room' },
  { test: (p) => p === '/live-queue', label: 'Live Queue' },
  { test: (p) => p === '/dashboard', label: 'Dashboard' },
  { test: (p) => p === '/doctor/profile', label: 'Doctor Profile' },
  { test: (p) => p === '/appointments', label: 'Appointments' },
  { test: (p) => p.startsWith('/appointments/'), label: 'Appointment Details' },
  { test: (p) => p === '/analytics', label: 'Analytics' },
  { test: (p) => p.startsWith('/patient-history/'), label: 'Patient History' },
  { test: (p) => p === '/settings', label: 'Settings' },
  { test: (p) => p === '/receptionist', label: 'Reception Dashboard' },
  { test: (p) => p === '/admin-dashboard', label: 'Admin Dashboard' },
  { test: (p) => p === '/admin/add-doctor', label: 'Add Doctor' },
  { test: (p) => p === '/doctor-login', label: 'Doctor Login' },
  { test: (p) => p === '/admin-login', label: 'Admin Login' },
  { test: (p) => p === '/receptionist-login', label: 'Receptionist Login' },
  { test: (p) => p === '/patient-login', label: 'Patient Login' },
  { test: (p) => p === '/patient-register', label: 'Patient Register' },
  { test: (p) => p === '/patient-dashboard', label: 'My Dashboard' },
  { test: (p) => p === '/medical-reports', label: 'Medical Reports' },
  { test: (p) => p === '/profile', label: 'Profile' },
  { test: (p) => p.startsWith('/appointment/'), label: 'Appointment Details' },
];

function useBreadcrumb(pathname) {
  const match = ROUTE_LABELS.find((r) => r.test(pathname));
  return match?.label || null;
}

const MenuIcon = () => <List weight="duotone" className="w-5 h-5" aria-hidden="true" />;

const BellIcon = () => <Bell weight="duotone" className="w-4 h-4" aria-hidden="true" />;

// Matches the pill/outline button geometry the redesigned pages use for
// their small square icon actions.
const ICON_BTN =
  'inline-flex items-center justify-center w-10 h-10 rounded-xl border border-slate-300 dark:border-surface-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/[0.04] active:scale-[0.98] transition duration-150';

const Header = ({ onMenuClick }) => {
  const location = useLocation();
  const [notifOpen, setNotifOpen] = useState(false);

  const isHomePage = location.pathname === '/';
  const breadcrumb = useBreadcrumb(location.pathname);

  const isLoggedIn =
    !!localStorage.getItem('doctorToken') ||
    !!localStorage.getItem('adminToken') ||
    !!localStorage.getItem('receptionistToken');

  return (
    <header className="sticky top-0 z-30 bg-white dark:bg-surface-card border-b border-slate-200 dark:border-surface-border animate-slide-down">
      <div className="px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {/* Mobile sidebar toggle - only relevant where a sidebar exists */}
          {!isHomePage && (
            <button
              type="button"
              onClick={onMenuClick}
              className={`${ICON_BTN} md:hidden shrink-0`}
              aria-label="Open navigation menu"
            >
              <MenuIcon />
            </button>
          )}

          {/* Logo - the Sidebar carries this everywhere else; shown here
              only on the home page, which has no sidebar. */}
          {isHomePage && (
            <Link to="/" className="flex items-center gap-3 group shrink-0" aria-label="MediFlow home">
              <div className="w-9 h-9 bg-primary-600 rounded-xl flex items-center justify-center group-hover:scale-105 transition duration-200">
                <Heart weight="fill" className="w-5 h-5 text-white" aria-hidden="true" />
              </div>
              <span className="font-bold text-slate-900 dark:text-white text-sm tracking-tight hidden sm:block">
                MediFlow
              </span>
            </Link>
          )}

          {/* Breadcrumb */}
          {breadcrumb && (
            <nav aria-label="Breadcrumb" className="min-w-0 hidden sm:block">
              <ol className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 truncate">
                <li className="font-medium">MediFlow</li>
                <li aria-hidden="true">/</li>
                <li className="font-semibold text-slate-900 dark:text-slate-200 truncate">{breadcrumb}</li>
              </ol>
            </nav>
          )}
        </div>

        {/* RIGHT SIDE */}
        <div className="flex items-center gap-2 shrink-0">
          {/* NOTIFICATIONS - honest empty state, no fake counts */}
          {isLoggedIn && (
            <div className="relative">
              <button
                type="button"
                onClick={() => setNotifOpen((v) => !v)}
                className={ICON_BTN}
                aria-label="Notifications"
                aria-expanded={notifOpen}
              >
                <BellIcon />
              </button>
              {notifOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} aria-hidden="true" />
                  <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.14)] p-4 z-20 animate-scale-in">
                    <p className="text-sm font-semibold text-slate-900 dark:text-slate-200 mb-1">Notifications</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">You're all caught up - no new notifications.</p>
                  </div>
                </>
              )}
            </div>
          )}

        </div>
      </div>
    </header>
  );
};

export default Header;
