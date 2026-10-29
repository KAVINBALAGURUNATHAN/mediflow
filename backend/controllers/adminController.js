const Admin = require("../models/Admin");
const Doctor = require("../models/Doctor");
const Receptionist = require("../models/Receptionist");
const Nurse = require("../models/Nurse");
const LabTechnician = require("../models/LabTechnician");
const Appointment = require("../models/Appointment");
const BlockedSlot = require("../models/BlockedSlot");
const Specialization = require("../models/Specialization");
const Hospital = require("../models/Hospital");
const Patient = require("../models/Patient");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");

// A Hospital document represents one branch (e.g. name="MediFlow",
// branch="Downtown Clinic"). Every place that used to display just `hospital.name`
// needs this instead, or two branches of the same hospital brand collapse
// into the same label (and, worse, the same doctor.location string).
function formatHospitalLabel(hospital) {
  return hospital.branch ? `${hospital.name} – ${hospital.branch}` : hospital.name;
}

// Given optional specializationId/hospitalId in a create/update payload,
// resolve them against the master lists and return the derived free-text
// values (so the legacy `specialization`/`location` string fields - which
// every existing route/frontend page reads - stay in sync automatically).
// Throws a plain Error with a user-facing message if an id doesn't resolve,
// so callers can turn it into a 400 response.
async function resolveSpecializationAndHospital({ specializationId, hospitalId }) {
  const result = {};

  if (specializationId !== undefined && specializationId !== null && specializationId !== "") {
    if (!mongoose.Types.ObjectId.isValid(specializationId)) {
      throw new Error("Invalid specialization selected");
    }
    const spec = await Specialization.findOne({ _id: specializationId, isActive: true });
    if (!spec) {
      throw new Error("Selected specialization was not found");
    }
    result.specializationId = spec._id;
    result.specialization = spec.displayName || spec.name;
  }

  if (hospitalId !== undefined && hospitalId !== null && hospitalId !== "") {
    if (!mongoose.Types.ObjectId.isValid(hospitalId)) {
      throw new Error("Invalid hospital selected");
    }
    const hospital = await Hospital.findOne({ _id: hospitalId, isActive: true });
    if (!hospital) {
      throw new Error("Selected hospital was not found");
    }
    result.hospitalId = hospital._id;
    result.location = formatHospitalLabel(hospital);
  }

  return result;
}

// ===========================
// VALIDATION HELPERS
// ===========================
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isValidEmail = (email) => {
  return emailRegex.test(email.toLowerCase().trim());
};

const isValidPassword = (password) => {
  return password && password.length >= 8;
};

// ===========================
// ADMIN LOGIN
// ===========================
exports.adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    const admin = await Admin.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");

    if (!admin) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    const isMatch = await bcrypt.compare(password, admin.password);

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // Ensure JWT secret is configured
    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        message: "JWT secret is not configured",
      });
    }

    const token = jwt.sign(
      {
        adminId: admin._id,
        email: admin.email,
        role: admin.role || "admin",
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "7d",
      }
    );

    res.status(200).json({
      message: "Login successful",
      token,
      admin: {
        _id: admin._id,
        email: admin.email,
        role: admin.role || "admin",
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// ADMIN PROFILE
// ===========================
exports.profile = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin.adminId)
      .select("-password")
      .lean();

    if (!admin) {
      return res.status(404).json({
        message: "Admin not found",
      });
    }

    res.status(200).json({
      message: "Profile fetched successfully",
      admin,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// CHANGE PASSWORD
// ===========================
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        message: "Current password and new password are required",
      });
    }

    if (!isValidPassword(newPassword)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    const admin = await Admin.findById(req.admin.adminId);

    if (!admin) {
      return res.status(404).json({
        message: "Admin not found",
      });
    }

    const isMatch = await bcrypt.compare(
      currentPassword,
      admin.password
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "Current password is incorrect",
      });
    }

    admin.password = await bcrypt.hash(newPassword, 10);

    await admin.save();

    res.status(200).json({
      message: "Password changed successfully",
    });

  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// DASHBOARD
// ===========================
exports.dashboard = async (req, res) => {
  try {

    const [
      totalDoctors,
      totalReceptionists,
      totalAppointments,
      activeDoctors,
      blockedSlots
    ] = await Promise.all([
      Doctor.countDocuments(),
      Receptionist.countDocuments(),
      Appointment.countDocuments(),
      Doctor.countDocuments({ isAvailable: true }),
      BlockedSlot.countDocuments()
    ]);

    res.status(200).json({
      message: "Dashboard fetched successfully",
      dashboard: {
        totalDoctors,
        totalReceptionists,
        totalAppointments,
        activeDoctors,
        blockedSlots
      }
    });

  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// DOCTOR MANAGEMENT
// ===========================

// Create Doctor
exports.createDoctor = async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      specialization,
      experience,
      consultationFee,
      location,
      workingHoursStart,
      workingHoursEnd,
      slotDuration,
      isAvailable,
      workingDays,
      qualification,
      specializationId,
      hospitalId,
    } = req.body;

    // Resolve master-list references first (if provided) - these override
    // the free-text specialization/location below, so a doctor created
    // through the dropdown-based admin UI can never end up with typo'd
    // text, while any caller still using free text keeps working.
    let resolvedFromIds = {};
    try {
      resolvedFromIds = await resolveSpecializationAndHospital({ specializationId, hospitalId });
    } catch (resolveError) {
      return res.status(400).json({ message: resolveError.message });
    }

    const effectiveSpecialization = resolvedFromIds.specialization || specialization;
    const effectiveLocation = resolvedFromIds.location || location;

    // 1. Check required fields
    if (
      !name ||
      !effectiveSpecialization ||
      !effectiveLocation ||
      !email ||
      !password ||
      experience === undefined ||
      experience === null ||
      consultationFee === undefined ||
      consultationFee === null
    ) {
      return res.status(400).json({
        message: "Please fill all required fields",
      });
    }

    // 2. Validate Numeric Fields
    if (
      isNaN(experience) ||
      isNaN(consultationFee) ||
      (slotDuration !== undefined && isNaN(slotDuration))
    ) {
      return res.status(400).json({
        message: "Experience, consultation fee and slot duration must be numbers",
      });
    }

    // 3. Validate Email Format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: "Invalid email format",
      });
    }

    // 4. Validate Password Strength
    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    const existingDoctor = await Doctor.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existingDoctor) {
      return res.status(409).json({
        message: "Doctor with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const doctor = new Doctor({
      name: name.trim(),
      specialization: effectiveSpecialization.trim(),
      location: effectiveLocation.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      experience: Number(experience),
      consultationFee: Number(consultationFee),
      workingHours: {
        start: workingHoursStart || "09:00",
        end: workingHoursEnd || "17:00",
      },
      slotDuration: Number(slotDuration) || 20,
      isAvailable: isAvailable !== undefined ? isAvailable : true,
      // Omitted (rather than defaulted here) when not provided, so the
      // schema's own default (Mon-Sat) applies - see models/Doctor.js.
      ...(Array.isArray(workingDays) && workingDays.length
        ? { workingDays }
        : {}),
      ...(qualification !== undefined ? { qualification: qualification.trim() } : {}),
      ...(resolvedFromIds.specializationId ? { specializationId: resolvedFromIds.specializationId } : {}),
      ...(resolvedFromIds.hospitalId ? { hospitalId: resolvedFromIds.hospitalId } : {}),
    });

    await doctor.save();

    res.status(201).json({
      message: "Doctor created successfully",
      doctor: {
        _id: doctor._id,
        name: doctor.name,
        email: doctor.email,
        specialization: doctor.specialization,
        experience: doctor.experience,
        consultationFee: doctor.consultationFee,
        location: doctor.location,
        workingHours: doctor.workingHours,
        slotDuration: doctor.slotDuration,
        isAvailable: doctor.isAvailable,
        workingDays: doctor.workingDays,
        qualification: doctor.qualification,
        specializationId: doctor.specializationId,
        hospitalId: doctor.hospitalId,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get All Doctors
exports.getAllDoctors = async (req, res) => {
  try {
    const doctors = await Doctor.find().select("-password").lean();

    res.status(200).json({
      message: "Doctors fetched successfully",
      doctors,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Registered patients. Until now nothing surfaced the Patient collection to
// staff at all - /patients/search is doctor-only and queries Appointment, so
// a patient who registered but never booked was invisible everywhere.
// Paginated because this collection grows without bound.
exports.getAllPatients = async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const search = req.query.search?.trim();

    const query = {};

    if (search) {
      // Strip regex metacharacters rather than escaping them, so a search
      // string can never be interpreted as a pattern (ReDoS / injection).
      const safe = search.replace(/[^\w\s@.-]/g, "");
      const rx = { $regex: safe, $options: "i" };
      query.$or = [{ name: rx }, { phone: rx }, { email: rx }, { patientId: rx }];
    }

    const [patients, total] = await Promise.all([
      Patient.find(query)
        .select("patientId name phone email gender bloodGroup isActive createdAt")
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      Patient.countDocuments(query),
    ]);

    res.status(200).json({
      message: "Patients fetched successfully",
      patients,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get Single Doctor
exports.getDoctorById = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    const doctor = await Doctor.findById(id).select("-password").lean();

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    res.status(200).json({
      message: "Doctor fetched successfully",
      doctor,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Update Doctor
exports.updateDoctor = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    const doctor = await Doctor.findById(id);

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    const {
      name,
      email,
      password,
      specialization,
      experience,
      consultationFee,
      location,
      workingHoursStart,
      workingHoursEnd,
      slotDuration,
      isAvailable,
      workingDays,
      qualification,
      specializationId,
      hospitalId,
    } = req.body;

    let resolvedFromIds = {};
    try {
      resolvedFromIds = await resolveSpecializationAndHospital({ specializationId, hospitalId });
    } catch (resolveError) {
      return res.status(400).json({ message: resolveError.message });
    }

    // 1. Validate Numeric Parameters if provided
    if (
      (experience !== undefined && isNaN(experience)) ||
      (consultationFee !== undefined && isNaN(consultationFee)) ||
      (slotDuration !== undefined && isNaN(slotDuration))
    ) {
      return res.status(400).json({
        message: "Experience, consultation fee and slot duration must be numbers",
      });
    }

    // 2. Validate Email Format if updating email
    if (email) {
      if (!isValidEmail(email)) {
        return res.status(400).json({
          message: "Invalid email format",
        });
      }

      const emailLower = email.toLowerCase().trim();

      const existingEmail = await Doctor.findOne({
        email: emailLower,
        _id: { $ne: id },
      });

      if (existingEmail) {
        return res.status(409).json({
          message: "Doctor with this email already exists",
        });
      }

      doctor.email = emailLower;
    }

    // 3. Validate Password Strength if changing password
    if (password) {
      if (!isValidPassword(password)) {
        return res.status(400).json({
          message: "Password must be at least 8 characters long",
        });
      }
      doctor.password = await bcrypt.hash(password, 10);
    }

    if (name !== undefined) doctor.name = name.trim();

    // A resolved specializationId/hospitalId takes priority over free-text
    // specialization/location in the same request - this is what makes the
    // new admin dropdown authoritative while still accepting plain text
    // from any caller that doesn't send an id.
    if (resolvedFromIds.specialization) {
      doctor.specialization = resolvedFromIds.specialization;
      doctor.specializationId = resolvedFromIds.specializationId;
    } else if (specialization !== undefined) {
      doctor.specialization = specialization.trim();
    }

    if (resolvedFromIds.location) {
      doctor.location = resolvedFromIds.location;
      doctor.hospitalId = resolvedFromIds.hospitalId;
    } else if (location !== undefined) {
      doctor.location = location.trim();
    }
    if (experience !== undefined) {
      doctor.experience = Number(experience);
    }
    if (consultationFee !== undefined) {
      doctor.consultationFee = Number(consultationFee);
    }
    if (slotDuration !== undefined) {
      doctor.slotDuration = Number(slotDuration);
    }
    if (isAvailable !== undefined) {
      doctor.isAvailable = isAvailable;
    }

    if (workingDays !== undefined) {
      doctor.workingDays = workingDays;
    }

    if (qualification !== undefined) {
      doctor.qualification = qualification.trim();
    }

    if (
      workingHoursStart !== undefined ||
      workingHoursEnd !== undefined
    ) {
      doctor.workingHours = {
        start:
          workingHoursStart !== undefined
            ? workingHoursStart
            : doctor.workingHours.start,
        end:
          workingHoursEnd !== undefined
            ? workingHoursEnd
            : doctor.workingHours.end,
      };
    }

    await doctor.save();

    res.status(200).json({
      message: "Doctor updated successfully",
      doctor: {
        _id: doctor._id,
        name: doctor.name,
        email: doctor.email,
        specialization: doctor.specialization,
        experience: doctor.experience,
        consultationFee: doctor.consultationFee,
        location: doctor.location,
        workingHours: doctor.workingHours,
        slotDuration: doctor.slotDuration,
        isAvailable: doctor.isAvailable,
        workingDays: doctor.workingDays,
        qualification: doctor.qualification,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Delete Doctor
exports.deleteDoctor = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    const doctor = await Doctor.findByIdAndDelete(id);

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    // Delete associated appointments and blocked slots
    await Appointment.deleteMany({
      doctorId: id,
    });

    await BlockedSlot.deleteMany({
      doctorId: id,
    });

    res.status(200).json({
      message: "Doctor deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// LAB TECHNICIAN MANAGEMENT
// ===========================
// Mirrors nurse management deliberately - every staff account is the same
// shape of credential, and diverging here would mean several different
// answers to "how does an admin add a member of staff".

// Create Lab Technician
exports.createLabTechnician = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    const existingTechnician = await LabTechnician.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existingTechnician) {
      return res.status(409).json({
        message: "A lab technician with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const technician = new LabTechnician({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: "labTechnician",
    });

    await technician.save();

    res.status(201).json({
      message: "Lab technician created successfully",
      labTechnician: {
        _id: technician._id,
        name: technician.name,
        email: technician.email,
        role: technician.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get All Lab Technicians
exports.getAllLabTechnicians = async (req, res) => {
  try {
    const labTechnicians = await LabTechnician.find().select("-password").lean();

    res.status(200).json({
      message: "Lab technicians fetched successfully",
      labTechnicians,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Lab Technician
exports.updateLabTechnician = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lab technician ID" });
    }

    const technician = await LabTechnician.findById(id);

    if (!technician) {
      return res.status(404).json({ message: "Lab technician not found" });
    }

    const { name, email, password } = req.body;

    if (name !== undefined) {
      technician.name = name.trim();
    }

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      const emailLower = email.toLowerCase().trim();

      const existing = await LabTechnician.findOne({
        email: emailLower,
        _id: { $ne: id },
      });

      if (existing) {
        return res.status(409).json({
          message: "A lab technician with this email already exists",
        });
      }

      technician.email = emailLower;
    }

    if (password !== undefined) {
      if (!isValidPassword(password)) {
        return res.status(400).json({
          message: "Password must be at least 8 characters long",
        });
      }

      technician.password = await bcrypt.hash(password, 10);
    }

    await technician.save();

    res.status(200).json({
      message: "Lab technician updated successfully",
      labTechnician: {
        _id: technician._id,
        name: technician.name,
        email: technician.email,
        role: technician.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete Lab Technician
exports.deleteLabTechnician = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid lab technician ID" });
    }

    const technician = await LabTechnician.findByIdAndDelete(id);

    if (!technician) {
      return res.status(404).json({ message: "Lab technician not found" });
    }

    res.status(200).json({ message: "Lab technician deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// NURSE MANAGEMENT
// ===========================
// Mirrors receptionist management deliberately - a nurse account is the same
// shape of staff credential, and diverging here would mean two different
// answers to "how does an admin add a member of staff".

// Create Nurse
exports.createNurse = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required",
      });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ message: "Invalid email format" });
    }

    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    const existingNurse = await Nurse.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existingNurse) {
      return res.status(409).json({
        message: "Nurse with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const nurse = new Nurse({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: "nurse",
    });

    await nurse.save();

    res.status(201).json({
      message: "Nurse created successfully",
      nurse: {
        _id: nurse._id,
        name: nurse.name,
        email: nurse.email,
        role: nurse.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get All Nurses
exports.getAllNurses = async (req, res) => {
  try {
    const nurses = await Nurse.find().select("-password").lean();

    res.status(200).json({
      message: "Nurses fetched successfully",
      nurses,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update Nurse
exports.updateNurse = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid nurse ID" });
    }

    const nurse = await Nurse.findById(id);

    if (!nurse) {
      return res.status(404).json({ message: "Nurse not found" });
    }

    const { name, email, password } = req.body;

    if (name !== undefined) {
      nurse.name = name.trim();
    }

    if (email !== undefined) {
      if (!isValidEmail(email)) {
        return res.status(400).json({ message: "Invalid email format" });
      }

      const emailLower = email.toLowerCase().trim();

      const existing = await Nurse.findOne({
        email: emailLower,
        _id: { $ne: id },
      });

      if (existing) {
        return res.status(409).json({
          message: "Nurse with this email already exists",
        });
      }

      nurse.email = emailLower;
    }

    if (password !== undefined) {
      if (!isValidPassword(password)) {
        return res.status(400).json({
          message: "Password must be at least 8 characters long",
        });
      }

      nurse.password = await bcrypt.hash(password, 10);
    }

    await nurse.save();

    res.status(200).json({
      message: "Nurse updated successfully",
      nurse: {
        _id: nurse._id,
        name: nurse.name,
        email: nurse.email,
        role: nurse.role,
      },
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete Nurse
exports.deleteNurse = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid nurse ID" });
    }

    const nurse = await Nurse.findByIdAndDelete(id);

    if (!nurse) {
      return res.status(404).json({ message: "Nurse not found" });
    }

    res.status(200).json({ message: "Nurse deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// RECEPTIONIST MANAGEMENT
// ===========================

// Create Receptionist
exports.createReceptionist = async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email and password are required",
      });
    }

    // 1. Validate Email Format
    if (!isValidEmail(email)) {
      return res.status(400).json({
        message: "Invalid email format",
      });
    }

    // 2. Validate Password Strength
    if (!isValidPassword(password)) {
      return res.status(400).json({
        message: "Password must be at least 8 characters long",
      });
    }

    const existingReceptionist = await Receptionist.findOne({
      email: email.toLowerCase().trim(),
    });

    if (existingReceptionist) {
      return res.status(409).json({
        message: "Receptionist with this email already exists",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const receptionist = new Receptionist({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password: hashedPassword,
      role: "receptionist",
    });

    await receptionist.save();

    res.status(201).json({
      message: "Receptionist created successfully",
      receptionist: {
        _id: receptionist._id,
        name: receptionist.name,
        email: receptionist.email,
        role: receptionist.role,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get All Receptionists
exports.getAllReceptionists = async (req, res) => {
  try {
    const receptionists = await Receptionist.find().select("-password").lean();

    res.status(200).json({
      message: "Receptionists fetched successfully",
      receptionists,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Get Single Receptionist
exports.getReceptionistById = async (req, res) => {
  try {

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid receptionist ID",
      });
    }

    const receptionist = await Receptionist.findById(id)
      .select("-password")
      .lean();

    if (!receptionist) {
      return res.status(404).json({
        message: "Receptionist not found",
      });
    }

    res.status(200).json({
      message: "Receptionist fetched successfully",
      receptionist,
    });

  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Update Receptionist
exports.updateReceptionist = async (req, res) => {
  try {

    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid receptionist ID",
      });
    }

    const receptionist = await Receptionist.findById(id);

    if (!receptionist) {
      return res.status(404).json({
        message: "Receptionist not found",
      });
    }

    const { name, email, password } = req.body;

    if (name !== undefined) {
      receptionist.name = name.trim();
    }

    if (email !== undefined) {

      if (!isValidEmail(email)) {
        return res.status(400).json({
          message: "Invalid email format",
        });
      }

      const emailLower = email.toLowerCase().trim();

      const existing = await Receptionist.findOne({
        email: emailLower,
        _id: { $ne: id }
      });

      if (existing) {
        return res.status(409).json({
          message: "Receptionist with this email already exists",
        });
      }

      receptionist.email = emailLower;
    }

    if (password !== undefined) {

      if (!isValidPassword(password)) {
        return res.status(400).json({
          message: "Password must be at least 8 characters long",
        });
      }

      receptionist.password = await bcrypt.hash(password, 10);
    }

    await receptionist.save();

    res.status(200).json({
      message: "Receptionist updated successfully",
      receptionist: {
        _id: receptionist._id,
        name: receptionist.name,
        email: receptionist.email,
        role: receptionist.role,
      }
    });

  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Delete Receptionist
exports.deleteReceptionist = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid receptionist ID",
      });
    }

    const receptionist = await Receptionist.findByIdAndDelete(id);

    if (!receptionist) {
      return res.status(404).json({
        message: "Receptionist not found",
      });
    }

    res.status(200).json({
      message: "Receptionist deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// APPOINTMENT MANAGEMENT
// ===========================

// Get All Appointments (across every doctor)
exports.getAllAppointments = async (req, res) => {
  try {
    const appointments = await Appointment.find()
      .populate("doctorId", "name specialization")
      .sort({ appointmentDate: -1, createdAt: -1 });

    res.status(200).json({
      message: "Appointments fetched successfully",
      count: appointments.length,
      appointments,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// Delete Appointment (permanent - unlike Cancel, this removes the record
// entirely; restricted to admin since it destroys history rather than
// just changing status).
exports.deleteAppointment = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const appointment = await Appointment.findByIdAndDelete(id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    res.status(200).json({
      message: "Appointment deleted successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
};

// ===========================
// SPECIALIZATION MANAGEMENT
// (master list - doctors reference these by _id, never free text,
// from the admin dropdown. See resolveSpecializationAndHospital above.)
// ===========================

exports.getAllSpecializations = async (req, res) => {
  try {
    const specializations = await Specialization.find({ isActive: true })
      .sort({ name: 1 })
      .lean();

    res.status(200).json({
      message: "Specializations fetched successfully",
      specializations,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createSpecialization = async (req, res) => {
  try {
    const { name, displayName, icon, description } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    const existing = await Specialization.findOne({
      name: new RegExp(`^${name.trim()}$`, "i"),
    });

    if (existing) {
      return res.status(409).json({ message: "This specialization already exists" });
    }

    const specialization = await Specialization.create({
      name: name.trim(),
      displayName: displayName?.trim() || "",
      icon: icon?.trim() || "",
      description: description?.trim() || "",
    });

    res.status(201).json({
      message: "Specialization created successfully",
      specialization,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSpecialization = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid specialization ID" });
    }

    const specialization = await Specialization.findById(id);

    if (!specialization) {
      return res.status(404).json({ message: "Specialization not found" });
    }

    const { name, displayName, icon, description, isActive } = req.body;

    if (name !== undefined) specialization.name = name.trim();
    if (displayName !== undefined) specialization.displayName = displayName.trim();
    if (icon !== undefined) specialization.icon = icon.trim();
    if (description !== undefined) specialization.description = description.trim();
    if (isActive !== undefined) specialization.isActive = isActive;

    await specialization.save();

    res.status(200).json({
      message: "Specialization updated successfully",
      specialization,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteSpecialization = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid specialization ID" });
    }

    // Soft delete - doctors may already reference this by _id, so removing
    // the document outright would leave a dangling reference. isActive:false
    // hides it from the dropdown (getAllSpecializations only returns active
    // ones) without breaking any doctor already assigned to it.
    const inUse = await Doctor.countDocuments({ specializationId: id });

    if (inUse > 0) {
      const specialization = await Specialization.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true }
      );

      if (!specialization) {
        return res.status(404).json({ message: "Specialization not found" });
      }

      return res.status(200).json({
        message: `Specialization deactivated (still referenced by ${inUse} doctor${inUse === 1 ? "" : "s"})`,
        specialization,
      });
    }

    const specialization = await Specialization.findByIdAndDelete(id);

    if (!specialization) {
      return res.status(404).json({ message: "Specialization not found" });
    }

    res.status(200).json({ message: "Specialization deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ===========================
// HOSPITAL MANAGEMENT
// (master list - doctors reference these by _id, never free text,
// from the admin dropdown. See resolveSpecializationAndHospital above.)
// ===========================

exports.getAllHospitals = async (req, res) => {
  try {
    const hospitals = await Hospital.find({ isActive: true })
      .sort({ name: 1, branch: 1 })
      .lean();

    res.status(200).json({
      message: "Hospitals fetched successfully",
      hospitals,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.createHospital = async (req, res) => {
  try {
    const { name, branch, phone, address, city, state, country, latitude, longitude } = req.body;

    if (!name?.trim()) {
      return res.status(400).json({ message: "Name is required" });
    }

    // Duplicate check is on (name + branch) together, not name alone - one
    // hospital brand (e.g. "MediFlow") legitimately has multiple
    // branch records ("Downtown Clinic", "Riverside Clinic") sharing the same name.
    const existing = await Hospital.findOne({
      name: new RegExp(`^${name.trim()}$`, "i"),
      branch: new RegExp(`^${(branch || "").trim()}$`, "i"),
    });

    if (existing) {
      return res.status(409).json({ message: "This hospital branch already exists" });
    }

    const hospital = await Hospital.create({
      name: name.trim(),
      branch: branch?.trim() || "",
      phone: phone?.trim() || "",
      address: address?.trim() || "",
      city: city?.trim() || "",
      state: state?.trim() || "",
      country: country?.trim() || "",
      latitude: latitude !== undefined && latitude !== "" ? Number(latitude) : null,
      longitude: longitude !== undefined && longitude !== "" ? Number(longitude) : null,
    });

    res.status(201).json({
      message: "Hospital created successfully",
      hospital,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateHospital = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid hospital ID" });
    }

    const hospital = await Hospital.findById(id);

    if (!hospital) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    const { name, branch, phone, address, city, state, country, latitude, longitude, isActive } = req.body;

    if (name !== undefined) hospital.name = name.trim();
    if (branch !== undefined) hospital.branch = branch.trim();
    if (phone !== undefined) hospital.phone = phone.trim();
    if (address !== undefined) hospital.address = address.trim();
    if (city !== undefined) hospital.city = city.trim();
    if (state !== undefined) hospital.state = state.trim();
    if (country !== undefined) hospital.country = country.trim();
    if (latitude !== undefined) hospital.latitude = latitude === "" ? null : Number(latitude);
    if (longitude !== undefined) hospital.longitude = longitude === "" ? null : Number(longitude);
    if (isActive !== undefined) hospital.isActive = isActive;

    await hospital.save();

    res.status(200).json({
      message: "Hospital updated successfully",
      hospital,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.deleteHospital = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ message: "Invalid hospital ID" });
    }

    // Same soft-delete-if-referenced rationale as deleteSpecialization above.
    const inUse = await Doctor.countDocuments({ hospitalId: id });

    if (inUse > 0) {
      const hospital = await Hospital.findByIdAndUpdate(
        id,
        { isActive: false },
        { new: true }
      );

      if (!hospital) {
        return res.status(404).json({ message: "Hospital not found" });
      }

      return res.status(200).json({
        message: `Hospital deactivated (still referenced by ${inUse} doctor${inUse === 1 ? "" : "s"})`,
        hospital,
      });
    }

    const hospital = await Hospital.findByIdAndDelete(id);

    if (!hospital) {
      return res.status(404).json({ message: "Hospital not found" });
    }

    res.status(200).json({ message: "Hospital deleted successfully" });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};