const jwt = require("jsonwebtoken");

const labTechnicianAuth = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        message: "Access denied. No token provided.",
      });
    }

    if (!authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Invalid token format",
      });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      return res.status(401).json({
        message: "Invalid token format",
      });
    }

    // No fallback secret: if JWT_SECRET is ever unset, this must fail
    // loudly (jwt.verify throws) rather than silently signing/verifying
    // against a hardcoded, publicly-known string. Matches auth.js and
    // adminAuth.js - all the auth middlewares should behave identically
    // here.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "labTechnician") {
      return res.status(403).json({
        message: "Access denied. Lab technician authorization required.",
      });
    }

    req.labTechnician = decoded;

    next();
  } catch (error) {
    res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};

module.exports = labTechnicianAuth;