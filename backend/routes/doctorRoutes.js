const express = require("express");
const router = express.Router();

const doctorController = require("../controllers/doctorController");
const labOrderController = require("../controllers/labOrderController");
const auth = require("../middleware/auth");

// Mounted at /doctor in server.js. Every other /doctor/* endpoint is still
// declared inline there; unmatched paths fall through to those, so this
// router must only claim paths it actually handles.

// =========================
// Clinical Records
// =========================

router.post(
  "/appointments/:id/prescription",
  auth,
  doctorController.issuePrescription
);

router.post(
  "/appointments/:id/lab-result",
  auth,
  doctorController.recordLabResult
);

// Everything already written for this visit, plus the patient's earlier
// records, for the consultation screen.
router.get(
  "/appointments/:id/records",
  auth,
  doctorController.getAppointmentRecords
);

// Fill in a previously ordered test once the lab reports back.
// Legacy path: applies to LabResult documents created by the old free-text
// ordering flow. New orders go through /lab-orders below and are reported by
// the technician (Phase 4/5).
router.patch(
  "/lab-results/:id",
  auth,
  doctorController.updateLabResult
);

// =========================
// Lab Ordering (Phase 3)
// =========================
// The doctor's read-only view of the catalog. Same data as
// /admin/lab-tests, but active tests only and no write verbs - a doctor
// orders from the catalog, they do not edit it.
router.get("/lab-tests", auth, labOrderController.listOrderableTests);

// Order a catalog test for this visit. The body carries a labTestId, never a
// test name and never parameters.
router.post(
  "/appointments/:id/lab-orders",
  auth,
  labOrderController.createLabOrder
);

router.get(
  "/appointments/:id/lab-orders",
  auth,
  labOrderController.listLabOrdersForAppointment
);

// Withdraws the order (status "Cancelled"); it is never deleted.
router.patch(
  "/lab-orders/:orderId/cancel",
  auth,
  labOrderController.cancelLabOrder
);

module.exports = router;
