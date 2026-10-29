const express = require("express");
const router = express.Router();

const receptionistController = require("../controllers/receptionistController");
const receptionistAuth = require("../middleware/receptionistAuth");
const waitingListController = require("../controllers/waitingListController");

// =========================
// Public Route
// =========================

// Receptionist Login
router.post(
  "/login",
  receptionistController.receptionistLogin
);

// =========================
// Protected Routes - Self
// =========================

// Receptionist Profile
router.get(
  "/profile",
  receptionistAuth,
  receptionistController.profile
);

// Change Password
router.patch(
  "/change-password",
  receptionistAuth,
  receptionistController.changePassword
);

// =========================
// Dashboard
// =========================

router.get(
  "/dashboard",
  receptionistAuth,
  receptionistController.dashboard
);

// =========================
// Appointments
// =========================

// View Appointments
router.get(
  "/appointments",
  receptionistAuth,
  receptionistController.getAppointments
);

// Appointment Details
router.get(
  "/appointments/:id",
  receptionistAuth,
  receptionistController.getAppointmentById
);

// Check-in Patient
router.patch(
  "/appointments/:id/check-in",
  receptionistAuth,
  receptionistController.checkIn
);

// Update Priority
router.patch(
  "/appointments/:id/priority",
  receptionistAuth,
  receptionistController.updatePriority
);

// Keep a late patient in the queue - the other half of the late-arrival
// decision, beside POST /waiting-list with an appointmentId.
router.patch(
  "/appointments/:id/keep-in-queue",
  receptionistAuth,
  receptionistController.keepInQueue
);

// Cancel Appointment
router.patch(
  "/appointments/:id/cancel",
  receptionistAuth,
  receptionistController.cancelAppointment
);

// =========================
// Vitals
// =========================
// Intentionally absent. Recording and correcting vitals belongs to the nurse
// (PATCH /nurse/appointments/:id/vitals); a receptionist token must not be
// able to write a clinical measurement.

// =========================
// Waiting / Vacant List
// =========================
// Reception owns this: they are the only ones who can see who is actually in
// the building. Nothing here cancels an appointment because a slot time
// passed - see waitingListController.

router.get("/waiting-list", receptionistAuth, waitingListController.getWaitingList);
router.post("/waiting-list", receptionistAuth, waitingListController.addToWaitingList);
router.patch(
  "/waiting-list/:id/remove",
  receptionistAuth,
  waitingListController.removeFromWaitingList
);

// Gives the slot to whoever is at the FRONT of the list - priority first,
// then longest waiting. The one reception should use for an ordinary vacancy.
router.post(
  "/waiting-list/assign-next",
  receptionistAuth,
  waitingListController.assignNextWaiting
);

// Gives a SPECIFIC waiting patient a freed slot, for the cases that need
// judgement (the patient has left, or is not fit to be seen next).
router.post(
  "/waiting-list/:id/assign",
  receptionistAuth,
  waitingListController.assignVacancy
);

// Slots this doctor genuinely has free for the rest of today.
router.get("/vacancies", receptionistAuth, waitingListController.getVacancies);

// =========================
// Recovery Window
// =========================
// A period held for patients still on the waiting list. Same mechanism as
// one block per slot - which is why normal appointments outside it are
// untouched and a recovery booking is an ordinary Appointment.

router.post(
  "/recovery-window",
  receptionistAuth,
  waitingListController.openRecoveryWindow
);
router.delete(
  "/recovery-window",
  receptionistAuth,
  waitingListController.closeRecoveryWindow
);

// The ONLY way an appointment becomes a vacancy.
router.patch(
  "/appointments/:id/no-show",
  receptionistAuth,
  waitingListController.markNoShow
);

module.exports = router;
