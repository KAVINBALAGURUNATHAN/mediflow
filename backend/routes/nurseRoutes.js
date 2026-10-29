const express = require("express");
const router = express.Router();

const nurseController = require("../controllers/nurseController");
const nurseAuth = require("../middleware/nurseAuth");

// =========================
// Public Route
// =========================

// Nurse Login
router.post("/login", nurseController.nurseLogin);

// =========================
// Protected Routes - Self
// =========================

router.get("/profile", nurseAuth, nurseController.profile);

// =========================
// Clinical Preparation
// =========================

// Today's checked-in patients, split into awaiting-vitals and ready
router.get("/queue", nurseAuth, nurseController.getQueue);

// Record or correct vitals
router.patch(
  "/appointments/:id/vitals",
  nurseAuth,
  nurseController.recordVitals
);

// Hand the patient over to the doctor
router.patch(
  "/appointments/:id/ready",
  nurseAuth,
  nurseController.markReadyForDoctor
);

module.exports = router;
