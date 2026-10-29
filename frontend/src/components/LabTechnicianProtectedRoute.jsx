import PropTypes from "prop-types";
import { Navigate, useLocation } from "react-router-dom";
import { hasValidRole, clearSession } from "../utils/authToken";

// LabTechnician-only routes. Verifies role and expiry from the token itself,
// not just the presence of a localStorage key.
function LabTechnicianProtectedRoute({ children }) {
  const location = useLocation();
  const token = localStorage.getItem("labTechnicianToken");

  if (!hasValidRole(token, "labTechnician")) {
    if (token) clearSession("labTechnicianToken", "labTechnician");
    return <Navigate to="/lab-technician-login" state={{ from: location }} replace />;
  }

  return children;
}

LabTechnicianProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default LabTechnicianProtectedRoute;
