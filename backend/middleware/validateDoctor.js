const validateDoctor = (req, res, next) => {
  const {
    name,
    email,
    password,
    specialization,
    location,
    experience,
    consultationFee,
    specializationId,
    hospitalId,
  } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({
      success: false,
      message: "Doctor name is required",
    });
  }

  if (!email || !email.trim()) {
    return res.status(400).json({
      success: false,
      message: "Email is required",
    });
  }

  const trimmedEmail = email.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(trimmedEmail)) {
    return res.status(400).json({
      success: false,
      message: "Invalid email address",
    });
  }

  // Matches createDoctor's own isValidPassword check (>= 8), so this
  // middleware and the controller never disagree on what's valid.
  if (!password || password.length < 8) {
    return res.status(400).json({
      success: false,
      message: "Password must be at least 8 characters long",
    });
  }

  // Accept either the master-list id (new admin dropdown) or free text
  // (any existing caller) - adminController.js's createDoctor resolves
  // specializationId/hospitalId into the actual text before this ever
  // reaches the database, so at least one form of each is required here.
  if ((!specialization || !specialization.trim()) && !specializationId) {
    return res.status(400).json({
      success: false,
      message: "Specialization is required",
    });
  }

  if ((!location || !location.trim()) && !hospitalId) {
    return res.status(400).json({
      success: false,
      message: "Location is required",
    });
  }

  if (experience !== undefined) {
    const numericExperience = Number(experience);

    if (Number.isNaN(numericExperience) || numericExperience < 0) {
      return res.status(400).json({
        success: false,
        message: "Experience must be a valid number",
      });
    }

    // Matches Doctor.js schema's max: 80
    if (numericExperience > 80) {
      return res.status(400).json({
        success: false,
        message: "Experience must be 80 years or less",
      });
    }
  }

  if (consultationFee !== undefined) {
    const numericFee = Number(consultationFee);

    if (Number.isNaN(numericFee) || numericFee < 0) {
      return res.status(400).json({
        success: false,
        message: "Consultation fee must be a valid number",
      });
    }

    // Matches Doctor.js schema's max: 100000
    if (numericFee > 100000) {
      return res.status(400).json({
        success: false,
        message: "Consultation fee must be 100000 or less",
      });
    }
  }

  next();
};

module.exports = { validateDoctor };