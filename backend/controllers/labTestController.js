const mongoose = require("mongoose");
const LabTest = require("../models/LabTest");

// The lab test catalog. Admin owns it. `listLabTests` is exported separately
// from the write handlers so that the doctor-ordering (Phase 3) and technician
// (Phase 4) screens can mount the same read handler under their own role
// prefix rather than growing a second copy of it.

// Parameters arrive from a form as an array of loosely-typed objects. They are
// rebuilt field by field rather than passed through, so a client cannot inject
// schema keys the catalog does not define.
function normalizeParameters(input) {
  if (!Array.isArray(input)) {
    return { ok: false, message: "Parameters must be a list" };
  }

  const parameters = [];

  for (const raw of input) {
    const name = String(raw?.name ?? "").trim();

    // A blank row is how a form sends "I added a row and changed my mind",
    // so it is dropped rather than rejected.
    if (!name) continue;

    const dataType = raw?.dataType === "text" ? "text" : "number";

    parameters.push({
      name,
      unit: String(raw?.unit ?? "").trim(),
      dataType,
      // Defaults to required: a parameter on a panel is normally run. Only an
      // explicit false opts out.
      required: raw?.required === false ? false : true,
      referenceRange: String(raw?.referenceRange ?? "").trim(),
    });
  }

  if (!parameters.length) {
    return { ok: false, message: "A lab test must define at least one parameter" };
  }

  return { ok: true, parameters };
}


// A duplicate name is refused by the unique index, but the clashing test may
// be RETIRED - in which case the admin is staring at a catalog that does not
// contain the name the server says is taken, with no way to work out why.
// Resolving the clash lets the message say "restore it" instead of stonewalling.
async function duplicateNameMessage(name) {
  const clash = await LabTest.findOne({ name: String(name ?? "").trim() })
    .collation({ locale: "en", strength: 2 })
    .lean();

  if (clash && !clash.isActive) {
    return `"${clash.name}" already exists but is retired. Restore it instead of creating a duplicate.`;
  }

  return "A lab test with this name already exists";
}

// ===========================
// LIST (admin, doctor, technician)
// ===========================
exports.listLabTests = async (req, res) => {
  try {
    // Retired tests stay in the collection so old results still resolve, but
    // they must not appear in an ordering or catalog list. ?includeInactive=1
    // is for the admin screen, which has to be able to bring one back.
    const filter =
      req.query.includeInactive === "1" ? {} : { isActive: true };

    const labTests = await LabTest.find(filter)
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
// GET ONE
// ===========================
exports.getLabTestById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lab test ID" });
    }

    const labTest = await LabTest.findById(id).lean();

    if (!labTest) {
      return res.status(404).json({ message: "Lab test not found" });
    }

    res.status(200).json({ message: "Lab test fetched successfully", labTest });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// CREATE (admin)
// ===========================
exports.createLabTest = async (req, res) => {
  try {
    const { name, shortName, category, parameters } = req.body;

    if (!String(name ?? "").trim()) {
      return res.status(400).json({ message: "Test name is required" });
    }

    const normalized = normalizeParameters(parameters);

    if (!normalized.ok) {
      return res.status(400).json({ message: normalized.message });
    }

    const labTest = new LabTest({
      name: String(name).trim(),
      shortName: String(shortName ?? "").trim(),
      category: String(category ?? "").trim() || "General",
      parameters: normalized.parameters,
    });

    await labTest.save();

    res.status(201).json({
      message: "Lab test created successfully",
      labTest,
    });
  } catch (error) {
    // The unique index is what actually prevents a duplicate name, so its
    // error is translated here rather than pre-checked with a findOne that a
    // concurrent write could slip past. The lookup below runs only after the
    // index has already rejected the write, so it cannot itself race.
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: await duplicateNameMessage(req.body?.name) });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid lab test",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

// ===========================
// UPDATE (admin)
// ===========================
// Adding a parameter to an existing test is an update, not a separate
// endpoint: the catalog entry is the unit of editing, and a parameter has no
// meaning outside the test that defines it.
exports.updateLabTest = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lab test ID" });
    }

    const labTest = await LabTest.findById(id);

    if (!labTest) {
      return res.status(404).json({ message: "Lab test not found" });
    }

    const { name, shortName, category, parameters, isActive } = req.body;

    if (name !== undefined) {
      if (!String(name).trim()) {
        return res.status(400).json({ message: "Test name is required" });
      }
      labTest.name = String(name).trim();
    }

    if (shortName !== undefined) {
      labTest.shortName = String(shortName).trim();
    }

    if (category !== undefined) {
      labTest.category = String(category).trim() || "General";
    }

    if (parameters !== undefined) {
      const normalized = normalizeParameters(parameters);

      if (!normalized.ok) {
        return res.status(400).json({ message: normalized.message });
      }

      labTest.parameters = normalized.parameters;
    }

    if (isActive !== undefined) {
      labTest.isActive = Boolean(isActive);
    }

    await labTest.save();

    res.status(200).json({
      message: "Lab test updated successfully",
      labTest,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res
        .status(409)
        .json({ message: await duplicateNameMessage(req.body?.name) });
    }

    if (error.name === "ValidationError") {
      return res.status(400).json({
        message: Object.values(error.errors)[0]?.message || "Invalid lab test",
      });
    }

    res.status(500).json({ message: error.message });
  }
};

// ===========================
// RETIRE (admin)
// ===========================
// Deactivates rather than deletes. Results already reported against a test
// keep their meaning, and a doctor's past order does not become an order for
// nothing.
exports.deactivateLabTest = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lab test ID" });
    }

    const labTest = await LabTest.findById(id);

    if (!labTest) {
      return res.status(404).json({ message: "Lab test not found" });
    }

    labTest.isActive = false;
    await labTest.save();

    res.status(200).json({
      message: "Lab test retired successfully",
      labTest,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
