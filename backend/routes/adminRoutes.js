const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");
const labTestController = require("../controllers/labTestController");
const adminAuth = require("../middleware/adminAuth");
const { validateDoctor } = require("../middleware/validateDoctor");

// ===========================
// PUBLIC ROUTES
// ===========================

// Admin Login
router.post("/login", adminController.adminLogin);

// ===========================
// ADMIN SELF
// ===========================

// Admin Profile
router.get("/profile", adminAuth, adminController.profile);

// Change Password
router.patch(
  "/change-password",
  adminAuth,
  adminController.changePassword
);

// ===========================
// DASHBOARD
// ===========================

router.get("/dashboard", adminAuth, adminController.dashboard);

// ===========================
// DOCTOR MANAGEMENT
// ===========================

// Create Doctor
router.post(
  "/doctors",
  adminAuth,
  validateDoctor,
  adminController.createDoctor
);

// Get All Doctors
router.get("/doctors", adminAuth, adminController.getAllDoctors);

// Registered patients (paginated, optional ?search=). Nothing previously
// exposed the Patient collection to staff, so patients who registered but
// never booked were invisible in every portal.
router.get("/patients", adminAuth, adminController.getAllPatients);

// Get Single Doctor
router.get("/doctors/:id", adminAuth, adminController.getDoctorById);

// Update Doctor
router.put("/doctors/:id", adminAuth, adminController.updateDoctor);

// Delete Doctor
router.delete("/doctors/:id", adminAuth, adminController.deleteDoctor);

// ===========================
// RECEPTIONIST MANAGEMENT
// ===========================

// =========================
// Lab Test Catalog
// =========================
// The catalog is clinic-wide configuration, so it is admin-owned. Read access
// for doctors and technicians is Phase 3/4 work and is not mounted yet.

router.get("/lab-tests", adminAuth, labTestController.listLabTests);
router.get("/lab-tests/:id", adminAuth, labTestController.getLabTestById);
router.post("/lab-tests", adminAuth, labTestController.createLabTest);
router.put("/lab-tests/:id", adminAuth, labTestController.updateLabTest);
// Retires the test rather than deleting it - see the controller.
router.delete("/lab-tests/:id", adminAuth, labTestController.deactivateLabTest);

// =========================
// Nurses
// =========================

router.get("/nurses", adminAuth, adminController.getAllNurses);
router.post("/nurses", adminAuth, adminController.createNurse);
router.put("/nurses/:id", adminAuth, adminController.updateNurse);
router.delete("/nurses/:id", adminAuth, adminController.deleteNurse);

// =========================
// Lab Technicians
// =========================

router.get("/lab-technicians", adminAuth, adminController.getAllLabTechnicians);
router.post("/lab-technicians", adminAuth, adminController.createLabTechnician);
router.put("/lab-technicians/:id", adminAuth, adminController.updateLabTechnician);
router.delete("/lab-technicians/:id", adminAuth, adminController.deleteLabTechnician);

// Get all receptionists
router.get(
  "/receptionists",
  adminAuth,
  adminController.getAllReceptionists
);

// Get single receptionist
router.get(
  "/receptionists/:id",
  adminAuth,
  adminController.getReceptionistById
);

// Create receptionist
router.post(
  "/receptionists",
  adminAuth,
  adminController.createReceptionist
);

// Update receptionist
router.put(
  "/receptionists/:id",
  adminAuth,
  adminController.updateReceptionist
);

// Delete receptionist
router.delete(
  "/receptionists/:id",
  adminAuth,
  adminController.deleteReceptionist
);

// ===========================
// SPECIALIZATION MANAGEMENT (master list, doctors reference by _id)
// ===========================

router.get("/specializations", adminAuth, adminController.getAllSpecializations);
router.post("/specializations", adminAuth, adminController.createSpecialization);
router.put("/specializations/:id", adminAuth, adminController.updateSpecialization);
router.delete("/specializations/:id", adminAuth, adminController.deleteSpecialization);

// ===========================
// HOSPITAL MANAGEMENT (master list, doctors reference by _id)
// ===========================

router.get("/hospitals", adminAuth, adminController.getAllHospitals);
router.post("/hospitals", adminAuth, adminController.createHospital);
router.put("/hospitals/:id", adminAuth, adminController.updateHospital);
router.delete("/hospitals/:id", adminAuth, adminController.deleteHospital);

// ===========================
// APPOINTMENT MANAGEMENT
// ===========================

// Get all appointments (across all doctors)
router.get(
  "/appointments",
  adminAuth,
  adminController.getAllAppointments
);

// Permanently delete an appointment
router.delete(
  "/appointments/:id",
  adminAuth,
  adminController.deleteAppointment
);

module.exports = router;