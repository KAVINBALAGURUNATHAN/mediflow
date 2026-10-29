import PropTypes from "prop-types";
import { Navigate, useLocation } from "react-router-dom";
import { hasValidRole, clearSession } from "../utils/authToken";

// Doctor-only routes. Verifies the token actually carries role "doctor" and
// has not expired, rather than only checking that the key exists - a stale
// doctorToken from an earlier session used to grant the whole doctor UI.
function DoctorProtectedRoute({ children }) {
  const location = useLocation();
  const doctorToken = localStorage.getItem("doctorToken");

  if (!hasValidRole(doctorToken, "doctor")) {
    // A token that is present but invalid, expired or wrong-role is dead weight:
    // drop it so it stops failing on every later navigation.
    if (doctorToken) clearSession("doctorToken", "doctor");
    return <Navigate to="/doctor-login" state={{ from: location }} replace />;
  }

  return children;
}

DoctorProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default DoctorProtectedRoute;
