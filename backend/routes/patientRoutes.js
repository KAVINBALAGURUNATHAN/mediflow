const express = require("express");
const rateLimit = require("express-rate-limit");
const router = express.Router();

// Same policy as the staff logins in server.js: throttle only the endpoints
// where guessing is cheap, so browsing and booking stay unthrottled.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again in a few minutes." },
});

const patientController = require("../controllers/patientController");
const patientAuth = require("../middleware/patientAuth");

// =========================
// Public Routes
// =========================

router.post("/register", authLimiter, patientController.register);
router.post("/login", authLimiter, patientController.login);
router.post("/forgot-password", authLimiter, patientController.forgotPassword);
router.post("/reset-password", authLimiter, patientController.resetPassword);
router.post("/google-auth", authLimiter, patientController.googleAuth);
router.post("/google-complete", authLimiter, patientController.googleComplete);

// =========================
// Protected Routes - Self
// =========================

router.get("/profile", patientAuth, patientController.getProfile);
router.patch("/profile", patientAuth, patientController.updateProfile);
router.get("/appointments", patientAuth, patientController.getMyAppointments);
router.get("/prescriptions", patientAuth, patientController.getMyPrescriptions);
router.get("/lab-results", patientAuth, patientController.getMyLabResults);
router.patch("/appointments/:id/cancel", patientAuth, patientController.cancelMyAppointment);
router.patch("/appointments/:id/reschedule", patientAuth, patientController.rescheduleMyAppointment);
router.patch("/change-password", patientAuth, patientController.changePassword);

module.exports = router;
