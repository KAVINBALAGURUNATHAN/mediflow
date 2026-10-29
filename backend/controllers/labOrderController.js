const mongoose = require("mongoose");
const Appointment = require("../models/Appointment");
const LabTest = require("../models/LabTest");
const LabOrder = require("../models/LabOrder");

// Doctor-side lab ordering against the catalog.
//
// The doctor picks a test; they never type a test name and never type its
// parameters. Both come from the LabTest the order points at, which is the
// whole reason the catalog exists.

// Same gate as doctorController's - an order is written against an
// appointment, so ownership of the appointment is what authorizes it.
// Duplicated deliberately rather than exported across controllers: it reads
// `req.params.id`, and a shared version would have to grow a parameter that
// makes the security boundary less obvious at each call site.
async function resolveOwnedAppointment(req, res) {
  if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
    res.status(400).json({ message: "Invalid appointment ID" });
    return null;
  }

  const appointment = await Appointment.findById(req.params.id);

  if (!appointment) {
    res.status(404).json({ message: "Appointment not found" });
    return null;
  }

  if (appointment.doctorId.toString() !== req.doctor.doctorId) {
    res.status(403).json({
      message: "You are not authorized to update this appointment",
    });
    return null;
  }

  return appointment;
}

// What the doctor and the technician need to see about an order: who it is
// for, which test, and where it has got to. Populated rather than
// denormalised so a corrected test name or reference range shows through
// everywhere immediately.
const ORDER_POPULATE = [
  { path: "labTestId", select: "name shortName category parameters isActive" },
  { path: "doctorId", select: "name specialization" },
];

// ===========================
// CATALOG (doctor)
// ===========================
// The doctor's read-only view of the catalog, so the order form has something
// to choose from. Retired tests are excluded: a doctor must not be able to
// order a test the clinic has withdrawn.
exports.listOrderableTests = async (req, res) => {
  try {
    const labTests = await LabTest.find({ isActive: true })
      .select("name shortName category parameters")
      .sort({ category: 1, name: 1 })
      .collation({ locale: "en", strength: 2 })
      .lean();

    res.status(200).json({
      message: "Lab tests fetched successfully",
      labTests,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// ORDER A TEST
// ===========================
exports.createLabOrder = async (req, res) => {
  try {
    const appointment = await resolveOwnedAppointment(req, res);
    if (!appointment) return;

    const { labTestId, note } = req.body;

    if (!mongoose.Types.ObjectId.isValid(labTestId ?? "")) {
      return res.status(400).json({ message: "Select a test to order" });
    }

    const labTest = await LabTest.findById(labTestId);

    if (!labTest) {
      return res.status(404).json({ message: "Lab test not found" });
    }

    // A retired test still resolves by id - old orders must keep making
    // sense - but no new order may be placed against one.
    if (!labTest.isActive) {
      return res.status(400).json({
        message: `${labTest.name} has been retired and can no longer be ordered`,
      });
    }

    // A visit with no patient record attached cannot carry an order: the
    // result would have nowhere to appear in the patient's portal.
    if (!appointment.patient) {
      return res.status(400).json({
        message: "This appointment has no patient record attached",
      });
    }

    // Ordering tests on a finished or void visit would put work on the
    // technician's list for a consultation that is already over.
    if (appointment.status === "Cancelled") {
      return res
        .status(400)
        .json({ message: "Cannot order a test on a cancelled appointment" });
    }

    // A completed consultation is a closed record everywhere else in this
    // codebase - vitals refuse it, and completion itself is gated on the
    // medical record being written. An order added afterwards would appear
    // on the technician's worklist attached to a visit that already ended,
    // and its result would arrive against a consultation whose conclusions
    // were reached without it.
    //
    // Tradeoff, stated plainly: a doctor who realises after signing off that
    // they meant to order a test cannot add it here. That is deliberate -
    // the alternative is letting a finished visit quietly grow new clinical
    // work, which is the looser of the two failure modes.
    if (appointment.status === "Completed") {
      return res.status(400).json({
        message: "Cannot order a test on a completed consultation",
      });
    }

    const labOrder = new LabOrder({
      appointmentId: appointment._id,
      // Taken from the appointment, never the body - see the model comment.
      patientId: appointment.patient,
      doctorId: appointment.doctorId,
      labTestId: labTest._id,
      note: String(note ?? "").trim(),
    });

    await labOrder.save();
    await labOrder.populate(ORDER_POPULATE);

    res.status(201).json({
      message: `${labTest.name} ordered`,
      labOrder,
    });
  } catch (error) {
    // The partial unique index is what actually prevents a duplicate, so its
    // error is translated here rather than pre-checked with a findOne that a
    // double-clicked button could slip past.
    if (error.code === 11000) {
      return res.status(409).json({
        message: "That test has already been ordered for this visit",
      });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid lab order",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

// ===========================
// ORDERS FOR ONE VISIT
// ===========================
exports.listLabOrdersForAppointment = async (req, res) => {
  try {
    const appointment = await resolveOwnedAppointment(req, res);
    if (!appointment) return;

    const labOrders = await LabOrder.find({ appointmentId: appointment._id })
      .populate(ORDER_POPULATE)
      .sort({ orderedAt: -1 })
      .lean();

    res.status(200).json({
      message: "Lab orders fetched successfully",
      labOrders,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// WITHDRAW AN ORDER
// ===========================
// Cancels rather than deletes: that the test was ordered and then withdrawn
// is itself part of the visit record. Cancelling clears the partial unique
// index, so the same test can be ordered again afterwards.
exports.cancelLabOrder = async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.orderId)) {
      return res.status(400).json({ message: "Invalid lab order ID" });
    }

    const labOrder = await LabOrder.findById(req.params.orderId);

    if (!labOrder) {
      return res.status(404).json({ message: "Lab order not found" });
    }

    // Ownership is checked against the order's own doctor, not the URL, so a
    // doctor cannot withdraw a colleague's order by guessing an id.
    if (labOrder.doctorId.toString() !== req.doctor.doctorId) {
      return res
        .status(403)
        .json({ message: "You are not authorized to change this lab order" });
    }

    // Once the lab has reported, the result stands. Withdrawing the order
    // underneath it would leave a result nothing asked for.
    if (labOrder.status === "Completed") {
      return res
        .status(400)
        .json({ message: "A completed test cannot be withdrawn" });
    }

    labOrder.status = "Cancelled";
    await labOrder.save();

    res.status(200).json({ message: "Lab order withdrawn", labOrder });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
