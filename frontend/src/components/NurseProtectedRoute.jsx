import PropTypes from "prop-types";
import { Navigate, useLocation } from "react-router-dom";
import { hasValidRole, clearSession } from "../utils/authToken";

// Nurse-only routes. Verifies role and expiry from the token itself,
// not just the presence of a localStorage key.
function NurseProtectedRoute({ children }) {
  const location = useLocation();
  const token = localStorage.getItem("nurseToken");

  if (!hasValidRole(token, "nurse")) {
    if (token) clearSession("nurseToken", "nurse");
    return <Navigate to="/nurse-login" state={{ from: location }} replace />;
  }

  return children;
}

NurseProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default NurseProtectedRoute;
