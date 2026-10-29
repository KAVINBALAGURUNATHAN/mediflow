const express = require("express");
const router = express.Router();

const labTechnicianController = require("../controllers/labTechnicianController");
const labTechnicianAuth = require("../middleware/labTechnicianAuth");

// =========================
// Public Route
// =========================

router.post("/login", labTechnicianController.labTechnicianLogin);

// =========================
// Protected Routes - Self
// =========================

router.get("/profile", labTechnicianAuth, labTechnicianController.profile);

// =========================
// Worklist
// =========================

// Outstanding orders across all patients, split into pending and in-progress
router.get("/worklist", labTechnicianAuth, labTechnicianController.getWorklist);

// Ordered -> In Progress. Recording the values is Phase 5.
router.patch(
  "/lab-orders/:orderId/start",
  labTechnicianAuth,
  labTechnicianController.startTest
);

// =========================
// Result Entry (Phase 5)
// =========================
// The form is GENERATED from the order's LabTest.parameters - the frontend has
// one form component, not one per test.
router.get(
  "/lab-orders/:orderId/result",
  labTechnicianAuth,
  labTechnicianController.getResultForm
);

// Save a draft, or complete the report with `complete: true`.
router.patch(
  "/lab-orders/:orderId/result",
  labTechnicianAuth,
  labTechnicianController.saveResult
);

module.exports = router;
