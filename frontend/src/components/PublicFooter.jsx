import { Link } from "react-router-dom";
import { useBranch } from "../context/BranchContext";

function formatBranchLabel(hospital) {
  return hospital.branch ? `${hospital.name} – ${hospital.branch}` : hospital.name;
}

// Shared footer for every public page - branch details are read live from
// the real `Hospital` collection (via BranchContext's `branches`, already
// fetched from GET /hospitals) rather than hardcoded, so this never drifts
// from what's actually in the database. address/phone are shown only when
// an admin has actually set them - no invented street addresses or phone
// numbers.
function PublicFooter() {
  const { branches } = useBranch();

  return (
    <footer className="border-t border-gray-200 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10">
        <div>
          <div className="flex items-center gap-2.5 mb-3">
            <div className="w-8 h-8 rounded-lg bg-primary-600 flex items-center justify-center">
              <span className="text-white font-bold text-xs">QC</span>
            </div>
            <p className="text-sm font-bold text-gray-900">QUEUE CURE</p>
          </div>
          <p className="text-sm text-gray-500 leading-relaxed">
            Digital appointment platform for Queue Cure's branches.
          </p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-3">Explore</p>
          <ul className="space-y-2 text-sm text-gray-500">
            <li><Link to="/departments" className="inline-block py-1 hover:text-gray-900 transition-colors">Departments</Link></li>
            <li><Link to="/health-packages" className="inline-block py-1 hover:text-gray-900 transition-colors">Health Packages</Link></li>
            <li><Link to="/emergency" className="inline-block py-1 hover:text-gray-900 transition-colors">Emergency</Link></li>
            <li><Link to="/contact" className="inline-block py-1 hover:text-gray-900 transition-colors">Contact</Link></li>
          </ul>
        </div>

        <div className="lg:col-span-2">
          <p className="text-xs font-semibold text-gray-900 uppercase tracking-wide mb-3">Our Branches</p>
          {branches.length === 0 ? (
            <p className="text-sm text-gray-500">No Queue Cure branches are configured.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {branches.map((hospital) => (
                <div key={hospital._id} className="text-sm">
                  <p className="font-semibold text-gray-900">{formatBranchLabel(hospital)}</p>
                  <p className="text-gray-500 mt-0.5">{hospital.address || "Address not listed yet"}</p>
                  <p className="text-gray-500">{hospital.phone || "Phone not listed yet"}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-gray-100">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-xs text-gray-500">
            © {new Date().getFullYear()} Queue Cure. All rights reserved.
          </p>
          <div className="flex items-center gap-4">
            <p className="text-xs text-gray-500">Medical emergency? Call 108.</p>
            {/* Staff sign-in lives here rather than in the header: it is for
                hospital staff, not for the patients this site is built for.
                Nothing was removed - /staff-login is a real route and each
                role's own login page is unchanged. */}
            <Link
              to="/staff-login"
              className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
            >
              Staff Login
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default PublicFooter;
