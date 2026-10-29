const LabTechnician = require("../models/LabTechnician");
const LabOrder = require("../models/LabOrder");
const Appointment = require("../models/Appointment");
const LabResult = require("../models/LabResult");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

// The laboratory's side of the flow. A doctor places a LabOrder against a
// catalog test (Phase 3); this is who picks it up.
//
// Deliberately mirrors nurseController: same login shape, same "resolve then
// check" gate, same reason. Recording the values on a started test is Phase 5
// - this phase only moves an order from Ordered to In Progress.

const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (email) =>
  emailRegex.test(String(email).toLowerCase().trim());

// ===========================
// LOGIN
// ===========================
exports.labTechnicianLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    const technician = await LabTechnician.findOne({
      email: String(email).toLowerCase().trim(),
    }).select("+password");

    // The same message for an unknown email and a wrong password, so the
    // response cannot be used to discover which staff emails exist.
    if (!technician) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await bcrypt.compare(password, technician.password);

    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ message: "JWT secret is not configured" });
    }

    const token = jwt.sign(
      {
        labTechnicianId: technician._id,
        email: technician.email,
        role: "labTechnician",
      },
      process.env.JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      labTechnician: {
        _id: technician._id,
        name: technician.name,
        email: technician.email,
        role: "labTechnician",
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// PROFILE
// ===========================
exports.profile = async (req, res) => {
  try {
    const technician = await LabTechnician.findById(
      req.labTechnician.labTechnicianId
    ).select("-password");

    if (!technician) {
      return res.status(404).json({ message: "Lab technician not found" });
    }

    res
      .status(200)
      .json({ message: "Profile fetched successfully", labTechnician: technician });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// The worklist needs the patient's name and the ordering doctor's, neither of
// which lives on the order itself. Only the fields the list renders are
// selected: the technician has no reason to read a patient's diagnosis,
// symptoms or contact details, so they are not sent at all rather than hidden
// in the UI.
const WORKLIST_POPULATE = [
  { path: "labTestId", select: "name shortName category parameters" },
  { path: "doctorId", select: "name specialization" },
  { path: "patientId", select: "name" },
  {
    path: "appointmentId",
    // `status` is not rendered - it is here so a void visit can be filtered
    // out. See dropVoidVisits below.
    select: "bookingId appointmentDate slot tokenNumber status",
  },
];

// An order belongs to a visit. If that visit was cancelled after the test was
// ordered, the order is work for a consultation that is not happening - the
// lab would run a sample for a patient who went home. The doctor's withdrawal
// path sets the ORDER to "Cancelled", but cancelling the APPOINTMENT does not
// touch its orders, so this is the only place that catches it.
//
// Filtered here rather than in the query because the condition lives on the
// joined appointment, and an aggregation pipeline would buy nothing at this
// size while making the rule much harder to see.
function dropVoidVisits(orders) {
  return orders.filter((order) => order.appointmentId?.status !== "Cancelled");
}

// ===========================
// WORKLIST
// ===========================
// Cross-patient and not scoped to today: a sample drawn this afternoon may
// legitimately still be outstanding tomorrow morning, and an order that
// silently dropped off the list at midnight would simply never be run.
exports.getWorklist = async (req, res) => {
  try {
    const [pending, inProgress] = await Promise.all([
      LabOrder.find({ status: "Ordered" })
        .populate(WORKLIST_POPULATE)
        // Oldest first - the queue is worked in the order it arrived.
        .sort({ orderedAt: 1 })
        .lean(),

      LabOrder.find({ status: "In Progress" })
        .populate(WORKLIST_POPULATE)
        .sort({ orderedAt: 1 })
        .lean(),
    ]);

    res.status(200).json({
      message: "Worklist fetched successfully",
      // Two lists rather than one flag: what has not been picked up yet and
      // what is on the bench are different jobs to the person reading this.
      pending: dropVoidVisits(pending),
      inProgress: dropVoidVisits(inProgress),
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// START A TEST
// ===========================
// Ordered -> In Progress. Deliberately the only transition this phase can
// make: recording values and completing the result is Phase 5.
exports.startTest = async (req, res) => {
  try {
    const { orderId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(orderId)) {
      return res.status(400).json({ message: "Invalid lab order ID" });
    }

    const labOrder = await LabOrder.findById(orderId);

    if (!labOrder) {
      return res.status(404).json({ message: "Lab order not found" });
    }

    // Already on the bench. Idempotent rather than an error, because two
    // technicians clicking the same row is a race, not a mistake - but the
    // response says plainly that nothing changed.
    if (labOrder.status === "In Progress") {
      await labOrder.populate(WORKLIST_POPULATE);
      return res.status(200).json({
        message: "That test is already in progress",
        labOrder,
      });
    }

    // Same rule as the worklist: a cancelled visit is not happening, so its
    // tests must not be startable either. Without this the order is merely
    // hidden from the list, and anyone holding its id could still start it.
    const appointment = await Appointment.findById(labOrder.appointmentId)
      .select("status")
      .lean();

    if (appointment?.status === "Cancelled") {
      return res.status(400).json({
        message: "That appointment was cancelled",
      });
    }

    // A withdrawn order is work the doctor called off, and a completed one is
    // already reported. Restarting either would put a result against
    // something nobody is currently asking for.
    if (labOrder.status !== "Ordered") {
      return res.status(400).json({
        message:
          labOrder.status === "Cancelled"
            ? "That order was withdrawn by the doctor"
            : "That test has already been reported",
      });
    }

    labOrder.status = "In Progress";
    labOrder.startedAt = new Date();
    labOrder.startedBy = req.labTechnician.labTechnicianId;

    await labOrder.save();
    await labOrder.populate(WORKLIST_POPULATE);

    res.status(200).json({ message: "Test started", labOrder });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Shared by the two result endpoints: loads the order, refuses the ones that
// cannot legitimately be reported, and carries its catalog definition along -
// the definition is what decides which values are even allowed.
async function resolveReportableOrder(req, res) {
  const { orderId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(orderId)) {
    res.status(400).json({ message: "Invalid lab order ID" });
    return null;
  }

  const labOrder = await LabOrder.findById(orderId).populate(
    "labTestId",
    "name shortName category parameters"
  );

  if (!labOrder) {
    res.status(404).json({ message: "Lab order not found" });
    return null;
  }

  if (labOrder.status === "Cancelled") {
    res.status(400).json({ message: "That order was withdrawn by the doctor" });
    return null;
  }

  const appointment = await Appointment.findById(labOrder.appointmentId)
    .select("status")
    .lean();

  if (appointment?.status === "Cancelled") {
    res.status(400).json({ message: "That appointment was cancelled" });
    return null;
  }

  if (!labOrder.labTestId) {
    res.status(400).json({
      message: "That order points at a test that is no longer in the catalog",
    });
    return null;
  }

  return labOrder;
}

// Values arrive keyed by parameter NAME and are rebuilt against the LabTest
// definition rather than trusted. This is the heart of the phase: the
// definition decides which parameters exist, what unit each carries and what
// range it is read against, so a client cannot invent a parameter, rename one,
// or quietly change a unit by posting a different string.
//
// The unit and reference range are COPIED onto the result rather than resolved
// through the catalog at read time. A range can be revised later, and a result
// already reported must keep the range it was actually read against.
function buildValues(labTest, submitted, flags) {
  const byName = new Map();

  if (submitted && typeof submitted === "object") {
    for (const [key, value] of Object.entries(submitted)) {
      byName.set(String(key).trim().toLowerCase(), value);
    }
  }

  const flagByName = new Map();

  if (flags && typeof flags === "object") {
    for (const [key, value] of Object.entries(flags)) {
      flagByName.set(String(key).trim().toLowerCase(), value);
    }
  }

  const values = [];
  const missing = [];

  for (const parameter of labTest.parameters) {
    const key = parameter.name.trim().toLowerCase();
    const raw = byName.get(key);
    const text = raw === undefined || raw === null ? "" : String(raw).trim();

    if (!text) {
      if (parameter.required) missing.push(parameter.name);
      // A blank optional parameter means "not run", which is not the same as
      // a zero, so it is left out rather than stored empty.
      continue;
    }

    // Numeric parameters must parse as numbers, but are still STORED as
    // strings: real reports mix readings with qualitative results, which is
    // why LabResult.values[].value has always been a String.
    if (parameter.dataType === "number" && !Number.isFinite(Number(text))) {
      return { ok: false, message: parameter.name + " must be a number" };
    }

    const flag = flagByName.get(key);

    values.push({
      parameter: parameter.name,
      value: text,
      unit: parameter.unit || "",
      referenceRange: parameter.referenceRange || "",
      flag: ["Normal", "High", "Low"].includes(flag) ? flag : "Normal",
    });
  }

  return { ok: true, values, missing };
}

// ===========================
// THE FORM DEFINITION
// ===========================
// What the technician's form should render, plus anything already saved. The
// fields come from LabTest.parameters, which is why the frontend has ONE form
// component and not one per test.
exports.getResultForm = async (req, res) => {
  try {
    const labOrder = await resolveReportableOrder(req, res);
    if (!labOrder) return;

    const existing = await LabResult.findOne({
      labOrderId: labOrder._id,
    }).lean();

    res.status(200).json({
      message: "Result form fetched successfully",
      labOrder: {
        _id: labOrder._id,
        status: labOrder.status,
        note: labOrder.note,
        orderedAt: labOrder.orderedAt,
      },
      labTest: labOrder.labTestId,
      // Null until a draft has been saved.
      labResult: existing || null,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// SAVE DRAFT / COMPLETE RESULT
// ===========================
// One endpoint, because a draft and a completed report are the same document
// at two points in its life. `complete: true` is what applies the
// required-parameter rule; a draft may be as incomplete as the bench is.
exports.saveResult = async (req, res) => {
  try {
    const labOrder = await resolveReportableOrder(req, res);
    if (!labOrder) return;

    const complete = req.body?.complete === true;
    const built = buildValues(
      labOrder.labTestId,
      req.body?.values,
      req.body?.flags
    );

    if (!built.ok) {
      return res.status(400).json({ message: built.message });
    }

    if (complete && built.missing.length) {
      return res.status(400).json({
        message: "Required: " + built.missing.join(", "),
      });
    }

    let labResult = await LabResult.findOne({ labOrderId: labOrder._id });

    // A reported result is a closed record, exactly like a completed
    // consultation or a completed visit's vitals. Without this the endpoint
    // silently rewrote it: a Haemoglobin of 11.2 could become 99 after the
    // doctor had already read and acted on the first value, with nothing in
    // the record showing it had changed. The form already said "can no longer
    // be edited" - which made that message decorative rather than true.
    //
    // Correcting a reported result is a real clinical need, but it is an
    // amendment with its own audit trail, not a silent overwrite. Until that
    // exists this refuses, which is the safe half of the choice.
    if (labResult?.status === "Completed") {
      return res.status(400).json({
        message: "That result has been reported and can no longer be changed",
      });
    }

    if (!labResult) {
      labResult = new LabResult({
        labOrderId: labOrder._id,
        labTestId: labOrder.labTestId._id,
        appointmentId: labOrder.appointmentId,
        patientId: labOrder.patientId,
        // The ORDERING doctor, taken from the order - never from the body,
        // and never the technician. This is what the doctor-side ownership
        // check compares against.
        doctorId: labOrder.doctorId,
        // Snapshotted at reporting time so a patient's old report does not
        // silently re-title itself if the catalog entry is renamed later.
        testName: labOrder.labTestId.name,
        orderedAt: labOrder.orderedAt,
      });
    }

    labResult.values = built.values;
    labResult.summary = String(req.body?.summary ?? "").trim();
    // resultedAt is stamped by the model's pre-validate hook, which also
    // refuses a completed result with no values - that rule is not duplicated
    // here.
    labResult.status = complete ? "Completed" : "In Progress";

    await labResult.save();

    // The order and its result must never disagree about where the test has
    // got to.
    labOrder.status = complete ? "Completed" : "In Progress";

    if (!labOrder.startedAt) {
      labOrder.startedAt = new Date();
      labOrder.startedBy = req.labTechnician.labTechnicianId;
    }

    await labOrder.save();

    res.status(200).json({
      message: complete ? "Result completed" : "Draft saved",
      labResult,
      labOrderStatus: labOrder.status,
    });
  } catch (error) {
    // The partial unique index on labOrderId is what actually prevents two
    // results for one order, so a double-submitted form lands here.
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: "A result for that order already exists" });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid result",
      });
    }

    res.status(500).json({ message: error.message });
  }
};
