import PropTypes from "prop-types";
import { Navigate, useLocation } from "react-router-dom";
import { hasValidRole, clearSession } from "../utils/authToken";

// Patient-only routes. Verifies the token carries role "patient" and has not
// expired, in addition to the stored patient profile the pages read from.
function PatientProtectedRoute({ children }) {
  const location = useLocation();
  const token = localStorage.getItem("patientToken");
  const patient = localStorage.getItem("patient");

  if (!hasValidRole(token, "patient") || !patient) {
    if (token) clearSession("patientToken", "patient");
    // Carries the originally-requested location so PatientLogin/PatientRegister
    // can send the patient back here after a successful login instead of
    // always dropping them on the dashboard.
    return <Navigate to="/patient-login" state={{ from: location }} replace />;
  }

  return children;
}

PatientProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default PatientProtectedRoute;
