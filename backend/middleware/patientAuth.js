const jwt = require("jsonwebtoken");

const patientAuth = (req, res, next) => {
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

    // No fallback secret - matches auth.js / receptionistAuth.js / adminAuth.js.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (decoded.role !== "patient") {
      return res.status(403).json({
        message: "Access denied. Patient authorization required.",
      });
    }

    req.patient = decoded;

    next();
  } catch (error) {
    res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};

module.exports = patientAuth;
