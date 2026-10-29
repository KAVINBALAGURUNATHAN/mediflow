import axios from "axios";

// Same env var as services/api.js/socket.js - "localhost" only works in a
// browser on the same machine as the backend. In a Capacitor-built mobile
// app, "localhost" means the phone itself, not the dev machine or server,
// so this must point at a real reachable host (your machine's LAN IP
// during development, or the deployed backend's URL in production) via
// VITE_API_URL, set at build time (frontend/.env, not committed).
const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:5000",
  headers: {
    "Content-Type": "application/json",
  },
});

// Automatically attach the correct JWT token for the role that owns the
// route being called. Doctor, Receptionist, and Admin each have separate
// backend auth (see middleware/auth.js, receptionistAuth.js, adminAuth.js) -
// sending the wrong role's token isn't just suboptimal, the backend
// middleware rejects it outright (403 "Access denied. X authorization
// required."), so this must match by URL prefix rather than a fixed
// priority order.
API.interceptors.request.use(
  (config) => {
    const doctorToken = localStorage.getItem("doctorToken");
    const receptionistToken = localStorage.getItem("receptionistToken");
    const nurseToken = localStorage.getItem("nurseToken");
    const labTechnicianToken = localStorage.getItem("labTechnicianToken");
    const adminToken = localStorage.getItem("adminToken");
    const patientToken = localStorage.getItem("patientToken");
    const token = localStorage.getItem("token");

    let authToken;

    if (config.url?.startsWith("/receptionist/")) {
      authToken = receptionistToken;
    } else if (config.url?.startsWith("/nurse/")) {
      authToken = nurseToken;
    } else if (config.url?.startsWith("/lab-technician/")) {
      authToken = labTechnicianToken;
    } else if (config.url?.startsWith("/admin/")) {
      authToken = adminToken;
    } else if (config.url?.startsWith("/patient/")) {
      authToken = patientToken;
    } else if (config.url?.startsWith("/doctor/") || config.url?.startsWith("/doctors/") || config.url?.startsWith("/appointments/") || config.url === "/appointments" || config.url?.startsWith("/patients/")) {
      authToken = doctorToken;
    } else {
      authToken = doctorToken || receptionistToken || nurseToken || labTechnicianToken || adminToken || patientToken || token;
    }

    if (authToken) {
      config.headers.Authorization = `Bearer ${authToken}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

export default API;