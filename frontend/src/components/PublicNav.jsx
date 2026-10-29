import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";

// Corporate header for the public MediFlow site. Patients are
// already on the hospital's own site, so doctor discovery lives on the
// homepage itself (Top Departments / Featured Specialists) rather than a
// separate "Find Doctors" nav item.
//
// Staff sign-in is a single secondary TEXT link to /staff-login, the role
// chooser (see StaffLogin.jsx). It is deliberately not a dropdown of every
// role - that put four internal destinations in the patient-facing bar - and
// deliberately not a button, so it never competes with Patient Portal, which
// is the primary action for the people this site is actually for. Staff need
// an obvious way in; they do not need the loudest control on the page.
// The same link is repeated in the footer for anyone who scrolls past.
// Plain and static - no dark mode toggle, no live-connection pill.
//
// The signed-in trigger stays labelled "Patient Portal" rather than the
// patient's own name, so the bar reads the same for guests and signed-in
// patients. The name belongs on the dashboard, not in site navigation.
const NAV_LINKS = [
  { label: "Home", to: "/" },
  { label: "Departments", to: "/departments" },
  { label: "Health Packages", to: "/health-packages" },
  { label: "Emergency", to: "/emergency", danger: true },
  { label: "Contact", to: "/contact" },
];

const PATIENT_MENU = [
  { label: "Dashboard", to: "/patient-dashboard" },
  { label: "My Appointments", to: "/my-appointments" },
  { label: "Medical Reports", to: "/medical-reports" },
  { label: "Profile", to: "/profile" },
];

function PublicNav() {
  const navigate = useNavigate();
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const accountMenuRef = useRef(null);

  const patientToken = localStorage.getItem("patientToken");
  const patient = (() => {
    try { return JSON.parse(localStorage.getItem("patient")); } catch { return null; }
  })();
  const isPatientLoggedIn = !!patientToken;
  const patientLabel = patient?.name?.split(" ")[0] || "My Account";

  useEffect(() => {
    if (!accountMenuOpen) return;
    const onClickOutside = (e) => {
      if (accountMenuRef.current && !accountMenuRef.current.contains(e.target)) {
        setAccountMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [accountMenuOpen]);

  const go = (path) => {
    setMobileMenuOpen(false);
    navigate(path);
  };

  const handlePatientLogout = () => {
    setAccountMenuOpen(false);
    localStorage.removeItem("patientToken");
    localStorage.removeItem("patient");
    navigate("/", { replace: true });
  };

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/95 backdrop-blur">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
            <span className="text-white font-bold text-xs">MF</span>
          </div>
          <div className="leading-tight hidden sm:block">
            <p className="text-sm font-bold text-gray-900 tracking-tight">MEDIFLOW</p>
            <p className="text-[10px] font-medium text-gray-500 tracking-wide">Digital Appointment Platform</p>
          </div>
        </Link>

        <nav className="hidden lg:flex items-center gap-7 text-sm font-medium text-gray-600">
          <Link to="/" className="py-2 hover:text-gray-900 transition-colors">Home</Link>
          <Link to="/departments" className="py-2 hover:text-gray-900 transition-colors">Departments</Link>
          <Link to="/health-packages" className="py-2 hover:text-gray-900 transition-colors">Health Packages</Link>
          <Link to="/emergency" className="py-2 text-red-600 hover:text-red-700 font-semibold transition-colors">Emergency</Link>
          <Link to="/contact" className="py-2 hover:text-gray-900 transition-colors">Contact</Link>
        </nav>

        <div className="flex items-center gap-2 shrink-0">
          {/* Below lg the main nav is hidden, so without this trigger there
              is no way to reach Departments, Emergency or Contact on a
              phone. */}
          <button
            type="button"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
            className="lg:hidden inline-flex items-center justify-center w-10 h-10 -ml-1 rounded-xl text-gray-600 hover:bg-gray-100 transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>

          {/* Secondary by design: plain text, muted, no chevron and no
              background - Patient Portal beside it stays the primary blue
              button. */}
          <Link
            to="/staff-login"
            className="hidden md:inline-flex items-center text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            Staff Login
          </Link>

          <div className="hidden sm:block w-px h-5 bg-gray-200 mx-1" />
          {isPatientLoggedIn ? (
            <div className="relative" ref={accountMenuRef}>
              <button
                type="button"
                onClick={() => setAccountMenuOpen((v) => !v)}
                aria-expanded={accountMenuOpen}
                aria-haspopup="true"
                className="btn-primary !py-2 !px-4 text-sm inline-flex items-center gap-1"
              >
                Patient Portal
                <svg className={`w-3.5 h-3.5 transition-transform duration-150 ${accountMenuOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {accountMenuOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 origin-top-right animate-scale-in">
                  {patientLabel && (
                    <p className="px-4 pt-1 pb-2 text-xs text-gray-500 border-b border-gray-100 mb-1">
                      Signed in as <span className="font-medium text-gray-700">{patientLabel}</span>
                    </p>
                  )}
                  {PATIENT_MENU.map(({ label, to }) => (
                    <button
                      key={to}
                      onClick={() => { setAccountMenuOpen(false); navigate(to); }}
                      className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                    >
                      {label}
                    </button>
                  ))}
                  <div className="border-t border-gray-100 my-1" />
                  <button onClick={handlePatientLogout} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50">
                    Logout
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button onClick={() => navigate("/patient-login")} className="btn-primary !py-2 !px-4 text-sm">
              Patient Portal
            </button>
          )}
        </div>
      </div>

      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-gray-200 bg-white">
          <nav className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-col">
            {NAV_LINKS.map(({ label, to, danger }) => (
              <button
                key={to}
                onClick={() => go(to)}
                className={`text-left px-2 py-3 text-[15px] font-medium rounded-lg hover:bg-gray-50 transition-colors ${
                  danger ? "text-red-600" : "text-gray-700"
                }`}
              >
                {label}
              </button>
            ))}

            {/* Below md the desktop link is hidden, so without this the only
                staff route on a phone would be the footer. One entry, same
                destination - not a list of roles. */}
            <button
              onClick={() => go("/staff-login")}
              className="text-left px-2 py-3 text-[15px] font-medium text-gray-500 rounded-lg hover:bg-gray-50 transition-colors"
            >
              Staff Login
            </button>
          </nav>
        </div>
      )}
    </header>
  );
}

export default PublicNav;
