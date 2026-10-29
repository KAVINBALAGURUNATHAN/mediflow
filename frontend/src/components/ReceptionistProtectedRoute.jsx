import PropTypes from "prop-types";
import { Navigate, useLocation } from "react-router-dom";
import { hasValidRole, clearSession } from "../utils/authToken";

// Receptionist-only routes. Verifies role and expiry from the token itself,
// not just the presence of a localStorage key.
function ReceptionistProtectedRoute({ children }) {
  const location = useLocation();
  const token = localStorage.getItem("receptionistToken");

  if (!hasValidRole(token, "receptionist")) {
    if (token) clearSession("receptionistToken", "receptionist");
    return <Navigate to="/receptionist-login" state={{ from: location }} replace />;
  }

  return children;
}

ReceptionistProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default ReceptionistProtectedRoute;
