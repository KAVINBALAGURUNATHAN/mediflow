import PropTypes from "prop-types";
import { Navigate, useLocation } from "react-router-dom";
import { hasValidRole, clearSession } from "../utils/authToken";

// Admin-only routes. Verifies role and expiry from the token itself, not just
// the presence of a localStorage key.
function AdminProtectedRoute({ children }) {
  const location = useLocation();
  const token = localStorage.getItem("adminToken");

  if (!hasValidRole(token, "admin")) {
    if (token) clearSession("adminToken", "admin");
    return <Navigate to="/admin-login" state={{ from: location }} replace />;
  }

  return children;
}

AdminProtectedRoute.propTypes = {
  children: PropTypes.node.isRequired,
};

export default AdminProtectedRoute;
