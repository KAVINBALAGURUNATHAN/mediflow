const jwt = require("jsonwebtoken");

const auth = (req, res, next) => {
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
    // against a hardcoded, publicly-known string.
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Doctor-only. Receptionists have their own separate identity
    // (receptionistId, no doctorId claim) and their own dedicated
    // router/middleware (receptionistAuth, routes/receptionistRoutes.js)
    // that correctly operates on each appointment's own embedded
    // doctorId rather than the caller's identity. They should never
    // authenticate against this middleware.
    if (decoded.role !== "doctor") {
      return res.status(403).json({
        message: "Access denied. Doctor authorization required.",
      });
    }

    req.doctor = decoded;

    next();
  } catch (error) {
    res.status(401).json({
      message: "Invalid or expired token",
    });
  }
};

module.exports = auth;