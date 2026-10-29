import { Navigate } from "react-router-dom";

function ProtectedRoute({ children }) {
  const token = localStorage.getItem("doctorToken");
  const doctor = localStorage.getItem("doctor");

  if (!token || !doctor) {
    return <Navigate to="/doctor-login" replace />;
  }

  return children;
}

export default ProtectedRoute;