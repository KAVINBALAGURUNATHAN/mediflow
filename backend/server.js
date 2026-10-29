require("dotenv").config();

const requiredEnv = [
  "MONGO_URI",
  "JWT_SECRET",
];

for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`❌ Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const patientAuth = require("./middleware/patientAuth");
const { sendBookingConfirmation } = require("./utils/appointmentMail");
const { requestReset, performReset } = require("./utils/passwordReset");
const mongoose = require("mongoose");
const http = require("http");
const { Server } = require("socket.io");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const PDFDocument = require("pdfkit");
const { createObjectCsvStringifier } = require("csv-writer");
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const sanitizeAppointmentForPatient = require("./utils/sanitizeAppointmentForPatient");

// ======================
// CONFIG
// ======================

const connectDB = require("./config/db");

// ======================
// MIDDLEWARE
// ======================

const auth = require("./middleware/auth");
const adminAuth = require("./middleware/adminAuth");
const { byQueueOrder } = require("./utils/queueOrder");
const { normalizeToIstDay } = require("./utils/istDay");
const getISTDayRange = require("./utils/getISTDayRange");
const { saveWithToken } = require("./utils/saveWithToken");

// ======================
// MODELS
// ======================

const Patient = require("./models/Patient");
const Doctor = require("./models/Doctor");
const Admin = require("./models/Admin");
const Appointment = require("./models/Appointment");
const Settings = require("./models/Settings");
const BlockedSlot = require("./models/BlockedSlot");
const Hospital = require("./models/Hospital");
const Specialization = require("./models/Specialization");

// ======================
// UTILS
// ======================

const generateSlots = require("./utils/generateSlots");
const {
  DEFAULT_WORKING_DAYS,
  getDoctorDaySlots,
  computeDoctorAvailability,
} = require("./utils/doctorAvailability");
const { getDateRangeFilter } = require("./utils/getDateRangeFilter");
const { haversineDistanceKm } = require("./utils/haversine");
const { matchSpecialization } = require("./services/aiService");

// ======================
// ROUTES
// ======================

const adminRoutes = require("./routes/adminRoutes");
const receptionistRoutes = require("./routes/receptionistRoutes");
const nurseRoutes = require("./routes/nurseRoutes");
const labTechnicianRoutes = require("./routes/labTechnicianRoutes");
const patientRoutes = require("./routes/patientRoutes");
const doctorRoutes = require("./routes/doctorRoutes");

// ======================
// EXPRESS
// ======================

const app = express();
const server = http.createServer(app);

// Render (and most PaaS) put the app behind a proxy, so req.ip is the proxy's
// address unless this is set. Without it every client looks like one IP and
// the rate limiters below would throttle all users together.
app.set("trust proxy", 1);

// Browser origins allowed to call this API. Anything not listed is refused by
// the browser's preflight. Requests with NO Origin header are allowed through:
// that covers curl and server-to-server calls.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

function isAllowedOrigin(origin) {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.includes(origin)) return true;
  // Vercel builds every deployment its own subdomain, so the preview URLs
  // cannot be enumerated ahead of time; match the project's domains instead.
  if (/^https:\/\/mediflow[a-z0-9-]*\.vercel\.app$/.test(origin)) return true;
  return false;
}

class CorsError extends Error {}

const corsOptions = {
  origin(origin, callback) {
    if (isAllowedOrigin(origin)) return callback(null, true);
    callback(new CorsError(`Origin ${origin} is not allowed`));
  },
  credentials: true,
};

const io = new Server(server, {
  cors: {
    origin(origin, callback) {
      if (isAllowedOrigin(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  },
});

app.set("io", io);

// Baseline security headers (HSTS, X-Content-Type-Options, X-Frame-Options,
// etc). Two defaults are turned off because they assume the server renders
// HTML for a browser to display directly, which this one never does - every
// route returns JSON (or a PDF attachment), always to a cross-origin SPA on
// Vercel:
//
//   - contentSecurityPolicy: a CSP protects a page's own script/style
//     sources. There is no page here for it to protect, and helmet's default
//     policy has broken PDF and file-download responses on other APIs before.
//   - crossOriginResourcePolicy: helmet's default is "same-origin", which
//     browsers also enforce against cross-origin fetch() - it would silently
//     block the Vercel frontend from reading Render's responses. Explicitly
//     "cross-origin" here is what makes that fetch legal; CORS above is a
//     separate, narrower allow-list that still governs who may ask at all.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
  })
);

app.use(cors(corsOptions));

// Without this a blocked origin surfaces as a 500, which reads like a server
// fault and hides genuine errors in the logs.
app.use((err, req, res, next) => {
  if (err instanceof CorsError) {
    return res.status(403).json({ message: "Origin not allowed" });
  }
  next(err);
});

app.use(express.json());

// Credential-guessing protection. Applied to the routes where a wrong answer
// is cheap to retry - logins, registration and the reset endpoints - rather
// than globally, so ordinary browsing is never throttled.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many attempts. Please try again in a few minutes." },
});

// A wider net so a single client cannot flood the API generally.
app.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 600,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Please slow down." },
  })
);

// Nurse and lab-technician were missing from this list entirely - those two
// logins had NO throttling, while every other role did. Password guessing
// against them was unlimited.
app.use(
  [
    "/doctor/login",
    "/admin/login",
    "/receptionist/login",
    "/nurse/login",
    "/lab-technician/login",
  ],
  authLimiter
);
app.use(["/doctor/forgot-password", "/doctor/reset-password"], authLimiter);

// ======================
// STARTUP HELPERS
// ======================

// A consultation left "In Consultation" when the process stopped is not a
// finished visit - the patient was mid-appointment and still needs to be
// seen. This used to mark every one of them "Completed" on each restart,
// which silently produced completed visits with no diagnosis, no
// prescription and no completedAt (updateMany skips the model hooks), and
// wiped the doctor's place in the queue.
//
// Put them back in the queue instead: status returns to Waiting and the
// consultation clock is cleared, so the doctor simply starts again. Nothing
// is fabricated and no record is lost.
//
// Scoped to today so an abandoned consultation from a previous day is left
// as historical data rather than being resurrected into the live queue.
const fixStuckPatients = async () => {
  try {
    // getISTDayRange, not setHours: appointmentDate is stored at IST
    // midnight while setHours resolves in the server's timezone. On Render
    // (UTC) this window started 5.5 hours late, so a consultation abandoned
    // early in the IST morning fell outside "today" and was left stuck.
    const { todayStart: startOfToday } = getISTDayRange(new Date());

    const result = await Appointment.updateMany(
      {
        status: "In Consultation",
        appointmentDate: { $gte: startOfToday },
      },
      {
        $set: { status: "Waiting" },
        $unset: { consultationStartedAt: "" },
      }
    );

    if (result.modifiedCount > 0) {
      console.log(
        `Returned ${result.modifiedCount} interrupted consultation(s) to the queue`
      );
    }
  } catch (error) {
    console.error(
      "Error returning interrupted consultations to the queue:",
      error.message
    );
  }
};

// A "Waiting" appointment that was never checked in (no tokenNumber) and
// whose date has already passed is a no-show, not a real current queue
// entry - left alone, it inflates any all-time "Waiting" count forever
// (see GET /doctor/dashboard/analytics's pendingAppointments) without ever
// appearing in, or blocking, an actual queue (those are always scoped to
// today). Only auto-cancels never-checked-in appointments from strictly
// PAST days - today's still-legitimately-waiting patients are untouched,
// and a patient who did check in (has a tokenNumber) is left for staff to
// resolve manually rather than silently rewriting a record where the
// patient actually showed up.
const expireStaleWaitingAppointments = async () => {
  try {
    const now = new Date();
    const { todayStart } = getISTDayRange(now);

    // Filter on checkedInAt, NOT on tokenNumber. This routine was written when
    // tokens were issued at check-in, so "no token" meant "never arrived".
    // Tokens are issued at BOOKING now, so that filter matched almost nothing
    // and past-day no-shows accumulated as "Waiting" forever, inflating the
    // doctor's pending count. Arrival is checkedInAt and has been since the
    // same assumption was fixed in the frontend's queueStatus.js.
    const stale = await Appointment.find({
      status: "Waiting",
      checkedInAt: null,
      appointmentDate: { $lt: todayStart },
    });

    if (stale.length === 0) return;

    // Saved one at a time rather than through updateMany. The rule that
    // releases the slot - `slotActive = status !== "Cancelled"` - lives in the
    // pre-save hook, which updateMany bypasses: the old version would have
    // left every one of these still holding its slot, re-creating a bug that
    // took two production incidents to eliminate.
    let expired = 0;

    for (const appointment of stale) {
      appointment.status = "Cancelled";
      appointment.cancelledAt = now;
      // Nobody withdrew these - the patient never came. See Appointment.noShowAt.
      appointment.noShowAt = now;
      await appointment.save();
      expired += 1;
    }

    console.log(`Expired ${expired} stale no-show appointment(s)`);
  } catch (error) {
    console.error(
      "Error expiring stale waiting appointments:",
      error.message
    );
  }
};

const seedAdmin = async () => {
  try {
    if ((await Admin.countDocuments()) === 0) {
      // No hardcoded fallback: the bootstrap admin only exists if both are set.
      const { ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;

      if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
        console.warn(
          "No admin account exists and ADMIN_EMAIL / ADMIN_PASSWORD are unset - skipping admin bootstrap"
        );
        return;
      }

      const hashedPassword = await bcrypt.hash(
        ADMIN_PASSWORD,
        10
      );

      const defaultAdmin = new Admin({
        email: ADMIN_EMAIL.toLowerCase().trim(),
        password: hashedPassword,
        role: "admin",
      });

      await defaultAdmin.save();

      console.log(`Bootstrap admin account created (${defaultAdmin.email})`);
    }
  } catch (error) {
    console.error(
      "Error seeding default admin:",
      error.message
    );
  }
};

// ======================
// DATABASE
// ======================

const PORT = process.env.PORT || 5000;

connectDB()
  .then(async () => {
    await fixStuckPatients();
    await expireStaleWaitingAppointments();
    await seedAdmin();

    console.log("Database initialized");

    // Also re-run periodically, not just at startup - this server process
    // can run for days, and an appointment only becomes "stale" once
    // midnight passes its date, which won't otherwise happen again until
    // the next restart.
    setInterval(expireStaleWaitingAppointments, 60 * 60 * 1000);

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error.message);
    process.exit(1);
  });
// ======================
// ROUTES
// ======================

app.use("/admin", adminRoutes);
app.use("/receptionist", receptionistRoutes);
app.use("/nurse", nurseRoutes);
app.use("/lab-technician", labTechnicianRoutes);
app.use("/patient", patientRoutes);

// Claims the clinical-record paths only (prescriptions, lab orders/results,
// and the consultation screen's records bundle) - every other /doctor/*
// endpoint is still declared inline below and is reached by falling through
// this router.
app.use("/doctor", doctorRoutes);

// ======================
// HOME
// ======================

app.get("/", (req, res) => {
  res.send("MediFlow Backend Working");
});

// ======================
// CONSULTATION SETTINGS
// ======================

// Clinic-wide wait estimate. Admin-only: this was previously unauthenticated,
// letting anyone rewrite the average every wait estimate is derived from.
// The GET below stays public - doctor, receptionist and queue screens all
// read it, some before any login.
app.post("/consultation-time", adminAuth, async (req, res) => {
  try {
    const time = Number(req.body.time);

    if (isNaN(time) || time <= 0) {
      return res.status(400).json({
        message: "Consultation time must be a positive number",
      });
    }

    let settings = await Settings.findOne();

    if (!settings) {
      settings = new Settings();
    }

    settings.averageConsultationTime = time;

    await settings.save();

    io.emit("settingsUpdated", {
      message: "Average consultation time updated",
      averageConsultationTime: settings.averageConsultationTime,
    });

    res.json({
      message: "Average consultation time updated",
      averageConsultationTime: settings.averageConsultationTime,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

app.get("/consultation-time", async (req, res) => {
  try {
    const settings = await Settings.findOne();

    res.json({
      averageConsultationTime:
        settings?.averageConsultationTime ?? 10,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// GET ALL DOCTORS
// ===========================
app.get("/doctors", async (req, res) => {
  try {
    // Optional branch filter - additive, existing callers that don't pass
    // hospitalId keep getting every doctor exactly as before.
    const { hospitalId } = req.query;
    const query = {};
    if (hospitalId) {
      if (!mongoose.Types.ObjectId.isValid(hospitalId)) {
        return res.status(400).json({ message: "Invalid hospitalId" });
      }
      query.hospitalId = hospitalId;
    }

    const doctors = await Doctor.find(query).select("-password"); // Exclude password field

    // Enrich each doctor with computed availability info (workingDays with
    // a safe fallback for doctors created before that field existed, next
    // bookable slot, remaining slots today, and a 3-state availability
    // summary). Additive only - every existing field is preserved via
    // doc.toObject(), so nothing already consuming this response breaks.
    const enrichedDoctors = await Promise.all(
      doctors.map(async (doc) => {
        const availability = await computeDoctorAvailability(
          doc,
          doc.workingDays
        );
        return {
          ...doc.toObject(),
          workingDays: doc.workingDays?.length
            ? doc.workingDays
            : DEFAULT_WORKING_DAYS,
          ...availability,
        };
      })
    );

    res.status(200).json({
      message: "Doctors fetched successfully",
      doctors: enrichedDoctors,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// GET ACTIVE SPECIALIZATIONS (public - departments list, no auth)
// ===========================
// Read-only public counterpart to adminController.js's getAllSpecializations -
// admins manage the list there, patients only ever read it here (department
// browsing on the homepage, /departments, etc).
app.get("/specializations", async (req, res) => {
  try {
    const specializations = await Specialization.find({ isActive: true }).sort({ name: 1 });
    res.status(200).json({
      message: "Specializations fetched successfully",
      specializations,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===========================
// GET ACTIVE HOSPITALS (public - branch picker, no auth)
// ===========================
// Read-only public counterpart to adminController.js's getAllHospitals -
// admins manage the list there, patients only ever read it here.
app.get("/hospitals", async (req, res) => {
  try {
    const hospitals = await Hospital.find({ isActive: true }).sort({ name: 1, branch: 1 });
    res.status(200).json({
      message: "Hospitals fetched successfully",
      hospitals,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===========================
// NEAREST HOSPITAL BRANCH (Haversine, no external API)
// ===========================
// Takes the patient's coordinates (from navigator.geolocation in the
// browser) and returns every active hospital that has coordinates set,
// sorted nearest-first. distanceKm/estimatedTravelMinutes are computed
// purely from the great-circle distance - no traffic data, no paid API -
// so estimatedTravelMinutes is a rough estimate (assumes ~25 km/h average
// city travel speed), not a real routing calculation.
const AVERAGE_CITY_SPEED_KMH = 25;

app.get("/hospitals/nearest", async (req, res) => {
  try {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ message: "Valid lat and lng query params are required" });
    }

    const hospitals = await Hospital.find({
      isActive: true,
      latitude: { $ne: null },
      longitude: { $ne: null },
    });

    const ranked = hospitals
      .map((h) => {
        const distanceKm = haversineDistanceKm(lat, lng, h.latitude, h.longitude);
        return {
          ...h.toObject(),
          distanceKm: Math.round(distanceKm * 10) / 10,
          estimatedTravelMinutes: Math.max(1, Math.round((distanceKm / AVERAGE_CITY_SPEED_KMH) * 60)),
        };
      })
      .sort((a, b) => a.distanceKm - b.distanceKm);

    if (ranked.length === 0) {
      return res.status(404).json({ message: "No hospitals with coordinates are available yet" });
    }

    res.status(200).json({
      message: "Nearest hospital resolved",
      nearest: ranked[0],
      hospitals: ranked,
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===========================
// GET DOCTOR BY ID
// ===========================
app.get("/doctors/:id", async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    const doctor = await Doctor.findById(req.params.id).select("-password"); // Exclude password field
    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    const availability = await computeDoctorAvailability(
      doctor,
      doctor.workingDays
    );

    const enrichedDoctor = {
      ...doctor.toObject(),
      workingDays: doctor.workingDays?.length
        ? doctor.workingDays
        : DEFAULT_WORKING_DAYS,
      ...availability,
    };

    res.status(200).json({
      message: "Doctor fetched successfully",
      doctor: enrichedDoctor,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// GET AVAILABLE SLOTS
// ===========================
app.get("/doctors/:id/slots", async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;

    // Validate doctor ID
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    // Date is required
    if (!date) {
      return res.status(400).json({
        message: "Date query parameter is required",
      });
    }

    // Validate date (YYYY-MM-DD)
    const [year, month, day] = date.split("-").map(Number);

    if (!year || !month || !day) {
      return res.status(400).json({
        message: "Invalid date format. Use YYYY-MM-DD",
      });
    }

    const selectedDate = new Date(year, month - 1, day);

    if (
      isNaN(selectedDate.getTime()) ||
      selectedDate.getFullYear() !== year ||
      selectedDate.getMonth() !== month - 1 ||
      selectedDate.getDate() !== day
    ) {
      return res.status(400).json({
        message: "Invalid date",
      });
    }

    // Prevent past dates. Compared as IST days: "yesterday" has to mean the
    // same thing here as it does everywhere else, on a UTC host too.
    const today = getISTDayRange().todayStart;
    const selectedDayStart = getISTDayRange(selectedDate).todayStart;

    if (selectedDayStart.getTime() < today.getTime()) {
      return res.status(400).json({
        message: "Date cannot be in the past",
      });
    }

    // Find doctor
    const doctor = await Doctor.findById(id).select("-password");

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    if (!doctor.isAvailable) {
      return res.status(400).json({
        message: "Doctor is currently unavailable",
      });
    }

    if (
      !doctor.workingHours?.start ||
      !doctor.workingHours?.end ||
      !doctor.slotDuration
    ) {
      return res.status(400).json({
        message: "Doctor schedule not configured",
      });
    }

    // Shared with the next-available-slot search (utils/doctorAvailability.js)
    // so both agree on exactly what "available" means for a given day.
    const { slots, totalSlots, fullDayBlocked } = await getDoctorDaySlots(
      doctor,
      selectedDate
    );

    if (fullDayBlocked) {
      return res.status(200).json({
        message: "Doctor is unavailable on this date",
        date,
        totalSlots,
        availableSlots: 0,
        slots: [],
      });
    }

    res.status(200).json({
      message: "Available slots fetched successfully",
      date,
      totalSlots,
      availableSlots: slots.length,
      slots,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// AI SYMPTOM -> SPECIALIZATION MATCH (public, no auth)
// The only AI-powered feature in this app - helps a patient who doesn't
// know medical terminology find the right specialist on the Find Doctors
// page by describing symptoms in plain language. Scoped entirely to this
// one endpoint; nothing else in the app calls aiService.
// ===========================
app.post("/doctors/suggest-specialization", async (req, res) => {
  try {
    const { symptoms } = req.body;

    if (!symptoms || typeof symptoms !== "string" || symptoms.trim().length < 5) {
      return res.status(400).json({
        message: "Please describe your symptoms in a bit more detail",
      });
    }

    const availableSpecializations = await Doctor.distinct("specialization", {
      isAvailable: true,
    });

    if (!availableSpecializations || availableSpecializations.length === 0) {
      return res.status(404).json({
        message: "No specializations are currently available",
      });
    }

    const { specialization, reasoning, confidence } = await matchSpecialization(
      symptoms.trim(),
      availableSpecializations
    );

    res.status(200).json({
      suggestedSpecialization: specialization,
      reasoning,
      confidence,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// PATIENT WAITING ROOM STATUS
// Public, no auth - a patient checks their queue position using their
// doctor + token number. Token numbers are only unique per doctor per
// day (see Appointment.js's compound unique index), so both are
// required to disambiguate - Dr. A's "token 5" and Dr. B's "token 5"
// can coexist on the same day.
// ===========================
app.get("/waiting-room/:doctorId/:tokenNumber", async (req, res) => {
  try {
    const { doctorId } = req.params;
    const yourToken = Number(req.params.tokenNumber);

    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    if (!Number.isInteger(yourToken) || yourToken < 1) {
      return res.status(400).json({
        message: "Invalid token number",
      });
    }

    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);
    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();
    const todayStart = new Date(
      Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
    );
    const todayEnd = new Date(
      Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
    );

    const yourAppointment = await Appointment.findOne({
      doctorId,
      appointmentDate: { $gte: todayStart, $lte: todayEnd },
      tokenNumber: yourToken,
    });

    if (!yourAppointment) {
      return res.status(404).json({
        message: "Token not found for this doctor today",
      });
    }

    if (yourAppointment.status === "Completed") {
      return res.json({
        currentToken: null,
        currentStatus: "Completed",
        yourToken,
        message: "Your consultation is completed",
        tokensAhead: 0,
        estimatedWait: 0,
      });
    }

    if (yourAppointment.status === "In Consultation") {
      return res.json({
        currentToken: yourAppointment.tokenNumber,
        currentStatus: "In Consultation",
        yourToken,
        message: "It's your turn!",
        tokensAhead: 0,
        estimatedWait: 0,
      });
    }

    const currentAppointment = await Appointment.findOne({
      doctorId,
      appointmentDate: { $gte: todayStart, $lte: todayEnd },
      status: "In Consultation",
    });

    const tokensAhead = await Appointment.countDocuments({
      doctorId,
      appointmentDate: { $gte: todayStart, $lte: todayEnd },
      tokenNumber: { $ne: null, $lt: yourToken },
      status: { $in: ["Waiting", "In Consultation"] },
    });

    const settings = await Settings.findOne();
    const averageConsultationTime = settings?.averageConsultationTime ?? 10;

    // If the doctor has set a real estimate for whoever's currently being
    // seen, use their actual remaining time instead of the flat average -
    // this is the whole point of letting the doctor set it. Everyone else
    // still waiting (not yet started) has no such estimate yet, so they
    // still fall back to the average.
    let estimatedWait;
    if (currentAppointment) {
      let currentRemaining = averageConsultationTime;
      if (currentAppointment.estimatedDurationMinutes && currentAppointment.consultationStartedAt) {
        const elapsedMinutes =
          (Date.now() - new Date(currentAppointment.consultationStartedAt).getTime()) / 60000;
        currentRemaining = Math.max(
          1,
          Math.round(currentAppointment.estimatedDurationMinutes - elapsedMinutes)
        );
      }
      const waitingAhead = Math.max(0, tokensAhead - 1);
      estimatedWait = currentRemaining + waitingAhead * averageConsultationTime;
    } else {
      estimatedWait = tokensAhead * averageConsultationTime;
    }

    res.json({
      currentToken: currentAppointment ? currentAppointment.tokenNumber : null,
      currentStatus: currentAppointment
        ? currentAppointment.status
        : "No patients currently in consultation",
      yourToken,
      tokensAhead,
      estimatedWait,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// DOCTOR LOGIN
// ===========================
// Doctor password reset. Shares utils/passwordReset with the patient flow, so
// the token hashing, expiry and no-email-enumeration rules are identical.
app.post("/doctor/forgot-password", async (req, res) => {
  try {
    const result = await requestReset({
      Model: Doctor,
      email: req.body.email,
      role: "doctor",
      resetPath: "/doctor-reset-password",
    });
    res.status(200).json(result);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/doctor/reset-password", async (req, res) => {
  try {
    const { email, token, newPassword } = req.body;
    const r = await performReset({ Model: Doctor, email, token, newPassword });
    res.status(r.status).json({ message: r.message });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

app.post("/doctor/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validate input
    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required",
      });
    }

    // Find doctor by email
    const doctor = await Doctor.findOne({
      email: email.toLowerCase().trim(),
    }).select("+password");

    if (!doctor) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

    // Compare password
    const isMatch = await bcrypt.compare(
      password,
      doctor.password
    );

    if (!isMatch) {
      return res.status(401).json({
        message: "Invalid email or password",
      });
    }

   const token = jwt.sign(
  {
    doctorId: doctor._id,
    email: doctor.email,
    role: "doctor",
  },
  process.env.JWT_SECRET,
  {
    expiresIn: "7d",
  }
);

    res.status(200).json({
      message: "Login successful",
      token,
      doctor: {
        _id: doctor._id,
        name: doctor.name,
        email: doctor.email,
        specialization: doctor.specialization,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// ===========================
// BLOCK SLOT / FULL DAY LEAVE
// ===========================

app.patch("/doctors/:id/block-slot", auth, async (req, res) => {
  try {
    // Validate doctor ID
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    // Doctor can only block their own schedule
    if (req.params.id !== req.doctor.doctorId) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    let {
      date,
      slot,
      isFullDay = false,
      reason = "",
    } = req.body;

    // Handle string values
    if (typeof isFullDay === "string") {
      isFullDay = isFullDay.toLowerCase() === "true";
    }

    if (!date) {
      return res.status(400).json({
        message: "Date is required",
      });
    }

    // Validate date
    const parsedDate = new Date(date);

    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        message: "Invalid date format",
      });
    }

    // IST midnight, matching how BlockedSlot.date and appointmentDate are
    // both stored - see utils/istDay.js.
    const blockDay = normalizeToIstDay(parsedDate);

    // Prevent blocking past dates
    const today = getISTDayRange().todayStart;

    if (blockDay.getTime() < today.getTime()) {
      return res.status(400).json({
        message: "Cannot block a past date",
      });
    }

    // Find doctor
    const doctor = await Doctor.findById(req.params.id);

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    // Ensure doctor's schedule exists
    if (
      !doctor.workingHours?.start ||
      !doctor.workingHours?.end ||
      !doctor.slotDuration
    ) {
      return res.status(400).json({
        message: "Doctor schedule not configured",
      });
    }

    // Validate slot if not full-day
    if (!isFullDay) {
      if (!slot) {
        return res.status(400).json({
          message: "Slot is required",
        });
      }

      const validSlots = generateSlots(
        doctor.workingHours.start,
        doctor.workingHours.end,
        doctor.slotDuration
      );

      if (!validSlots.includes(slot)) {
        return res.status(400).json({
          message: "Invalid slot value",
        });
      }
    }

    // Check if already blocked
    const existingBlock = await BlockedSlot.findOne({
      doctorId: doctor._id,
      date: blockDay,
      slot: isFullDay ? null : slot,
      isFullDay,
    });

    if (existingBlock) {
      return res.status(409).json({
        message: isFullDay
          ? "Doctor is already unavailable for this day"
          : "This slot is already blocked",
      });
    }

    // Prevent blocking an already booked slot
    if (!isFullDay) {
      const { todayStart: dayStart, todayEnd: dayEnd } =
        getISTDayRange(blockDay);

      const existingAppointment = await Appointment.findOne({
        doctorId: doctor._id,
        appointmentDate: {
          $gte: dayStart,
          $lte: dayEnd,
        },
        slot,
        status: {
          $ne: "Cancelled",
        },
      });

      if (existingAppointment) {
        return res.status(409).json({
          message:
            "Cannot block a slot that already has a booked appointment",
        });
      }
    }

    const blockedSlot = new BlockedSlot({
      doctorId: doctor._id,
      date: blockDay,
      slot: isFullDay ? null : slot,
      isFullDay,
      reason,
    });

    await blockedSlot.save();

    res.status(201).json({
      message: isFullDay
        ? "Doctor marked unavailable for the entire day"
        : "Slot blocked successfully",
      blockedSlot,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This slot is already blocked",
      });
    }

    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// UNBLOCK SLOT / REMOVE LEAVE
// ===========================
app.patch("/doctors/:id/unblock-slot", auth, async (req, res) => {
  try {
    // Validate doctor ID
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    // Doctor can only unblock their own schedule
    if (req.params.id !== req.doctor.doctorId) {
      return res.status(403).json({
        message: "Unauthorized",
      });
    }

    let { date, slot, isFullDay = false } = req.body;

    // Handle string values like "true"/"false"
    if (typeof isFullDay === "string") {
      isFullDay = isFullDay.toLowerCase() === "true";
    }

    if (!date) {
      return res.status(400).json({
        message: "Date is required",
      });
    }

    // Validate date
    const parsedDate = new Date(date);

    if (isNaN(parsedDate.getTime())) {
      return res.status(400).json({
        message: "Invalid date format",
      });
    }

    // Day boundaries as IST, matching how the block was stored.
    const { todayStart: dayStart, todayEnd: dayEnd } =
      getISTDayRange(parsedDate);

    const query = {
      doctorId: req.params.id,
      date: {
        $gte: dayStart,
        $lte: dayEnd,
      },
    };

    if (isFullDay) {
      query.isFullDay = true;
    } else {
      if (!slot) {
        return res.status(400).json({
          message: "Slot is required",
        });
      }

      query.slot = slot;
      query.isFullDay = false;
    }

    const deleted = await BlockedSlot.findOneAndDelete(query);

    if (!deleted) {
      return res.status(404).json({
        message: "Blocked slot not found",
      });
    }

    res.status(200).json({
      message: isFullDay
        ? "Full-day leave removed successfully"
        : "Slot unblocked successfully",
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// UPDATE DOCTOR PROFILE (self)
// ===========================
app.patch("/doctor/profile", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    const {
      name,
      specialization,
      location,
      experience,
      consultationFee,
      startTime,
      endTime,
      slotDuration,
    } = req.body;

    // Require both start and end time together
    if ((startTime && !endTime) || (!startTime && endTime)) {
      return res.status(400).json({
        message: "Both startTime and endTime are required",
      });
    }

    // Start time must be before end time
    if (startTime && endTime) {
      const [startH, startM] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);

      const startTotal = startH * 60 + startM;
      const endTotal = endH * 60 + endM;
      if (Number.isNaN(startTotal) || Number.isNaN(endTotal)) {
        return res.status(400).json({
          message: "Invalid time format. Use 'HH:mm' 24-hour format.",
        });
      }

      if (startTotal >= endTotal) {
        return res.status(400).json({
          message: "startTime must be before endTime",
        });
      }
    }
    if (slotDuration !== undefined && (!Number.isInteger(slotDuration) || slotDuration <= 0)) {
      return res.status(400).json({
        message: "slotDuration must be a positive integer",
      });
    }

    const doctor = await Doctor.findById(doctorId);
    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    if (name !== undefined) doctor.name = name;
    if (specialization !== undefined) doctor.specialization = specialization;
    if (location !== undefined) doctor.location = location.trim();
    if (experience !== undefined) doctor.experience = experience;
    if (consultationFee !== undefined) doctor.consultationFee = consultationFee;

    // If the doctor updates working hours or slot duration
    const scheduleChanged =
      startTime !== undefined || endTime !== undefined || slotDuration !== undefined;

    if (scheduleChanged) {
      const newStart = startTime !== undefined ? startTime : doctor.workingHours.start;
      const newEnd = endTime !== undefined ? endTime : doctor.workingHours.end;
      const newDuration = slotDuration !== undefined ? slotDuration : doctor.slotDuration;

      doctor.workingHours = { start: newStart, end: newEnd };
      doctor.slotDuration = newDuration;

      
     
    }

    await doctor.save();

    const { password, ...doctorWithoutPassword } = doctor.toObject();

    res.status(200).json({
      message: "Profile updated successfully",
      scheduleRegenerated: scheduleChanged,
      doctor: doctorWithoutPassword,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
app.patch("/doctor/availability", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;
    const { isAvailable } = req.body;

    if (typeof isAvailable !== "boolean") {
      return res.status(400).json({
        message: "isAvailable must be true or false",
      });
    }

    const doctor = await Doctor.findById(doctorId);

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    doctor.isAvailable = isAvailable;
    await doctor.save();

    res.status(200).json({
      message: `Doctor is now ${isAvailable ? "Available" : "Unavailable"}`,
      doctor: {
        _id: doctor._id,
        name: doctor.name,
        isAvailable: doctor.isAvailable,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// DOCTOR DASHBOARD STATS
// ===========================
app.get("/doctor/dashboard/stats", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    // Today's IST boundaries (matches live-queue / check-in / start-consultation)
    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const todayStart = new Date(
      Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
    );

    const todayEnd = new Date(
      Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
    );

    const dateFilter = {
      doctorId,
      appointmentDate: {
        $gte: todayStart,
        $lte: todayEnd,
      },
    };

    const [
      todayAppointments,
      waiting,
      inConsultation,
      completed,
      cancelled,
    ] = await Promise.all([
      Appointment.countDocuments(dateFilter),

      Appointment.countDocuments({
        ...dateFilter,
        status: "Waiting",
      }),

      Appointment.countDocuments({
        ...dateFilter,
        status: "In Consultation",
      }),

      Appointment.countDocuments({
        ...dateFilter,
        status: "Completed",
      }),

      Appointment.countDocuments({
        ...dateFilter,
        status: "Cancelled",
      }),
    ]);

    res.status(200).json({
      message: "Dashboard statistics fetched successfully",
      stats: {
        todayAppointments,
        waiting,
        inConsultation,
        completed,
        cancelled,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// DOCTOR DASHBOARD ANALYTICS
// ===========================
app.get("/doctor/dashboard/analytics", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    // Today (IST) - matches live-queue / check-in / start-consultation
    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const todayStart = new Date(
      Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
    );

    const todayEnd = new Date(
      Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
    );

    // Week (IST) - Sunday to Saturday, based on IST calendar day
    const istDayOfWeek = istNow.getUTCDay();

    const weekStart = new Date(
      Date.UTC(year, month, day - istDayOfWeek, 0, 0, 0, 0) - IST_OFFSET
    );

    const weekEnd = new Date(
      Date.UTC(year, month, day - istDayOfWeek + 6, 23, 59, 59, 999) - IST_OFFSET
    );

    const [
      totalAppointments,
      completedAppointments,
      cancelledAppointments,
      pendingAppointments,
      todayAppointments,
      weekAppointments,
    ] = await Promise.all([
      Appointment.countDocuments({
        doctorId,
      }),

      Appointment.countDocuments({
        doctorId,
        status: "Completed",
      }),

      Appointment.countDocuments({
        doctorId,
        status: "Cancelled",
      }),

      // Scoped to today, matching how "Waiting"/"In Consultation" is
      // defined everywhere else this app shows a live queue (waiting-room
      // endpoint, receptionist dashboard, live queue board) - without this,
      // an old appointment that was booked but never checked in (and whose
      // date has since passed) inflates this count forever, even though it
      // no longer appears in - or blocks - any actual queue.
      Appointment.countDocuments({
        doctorId,
        appointmentDate: { $gte: todayStart, $lte: todayEnd },
        status: {
          $in: ["Waiting", "In Consultation"],
        },
      }),

      Appointment.countDocuments({
        doctorId,
        appointmentDate: {
          $gte: todayStart,
          $lte: todayEnd,
        },
      }),

      Appointment.countDocuments({
        doctorId,
        appointmentDate: {
          $gte: weekStart,
          $lte: weekEnd,
        },
      }),
    ]);

    const completionRate =
      totalAppointments === 0
        ? 0
        : Number(
            (
              (completedAppointments /
                totalAppointments) *
              100
            ).toFixed(2)
          );

    const doctorObjectId = new mongoose.Types.ObjectId(doctorId);

    const [waitTimeAgg, consultationAgg, daysWithCompletionsAgg, doctorDoc] =
      await Promise.all([
        Appointment.aggregate([
          {
            $match: {
              doctorId: doctorObjectId,
              checkedInAt: { $ne: null },
              consultationStartedAt: { $ne: null },
            },
          },
          {
            $project: {
              waitMinutes: {
                $divide: [
                  { $subtract: ["$consultationStartedAt", "$checkedInAt"] },
                  60000,
                ],
              },
            },
          },
          { $group: { _id: null, avgWaitMinutes: { $avg: "$waitMinutes" } } },
        ]),

        Appointment.aggregate([
          {
            $match: {
              doctorId: doctorObjectId,
              consultationStartedAt: { $ne: null },
              completedAt: { $ne: null },
            },
          },
          {
            $project: {
              durationMinutes: {
                $divide: [
                  { $subtract: ["$completedAt", "$consultationStartedAt"] },
                  60000,
                ],
              },
            },
          },
          {
            $group: {
              _id: null,
              avgConsultationMinutes: { $avg: "$durationMinutes" },
            },
          },
        ]),

        Appointment.aggregate([
          { $match: { doctorId: doctorObjectId, status: "Completed" } },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$appointmentDate" } },
            },
          },
          { $count: "distinctDays" },
        ]),

        Doctor.findById(doctorId),
      ]);

    const avgWaitingTimeMinutes = waitTimeAgg[0]
      ? Number(waitTimeAgg[0].avgWaitMinutes.toFixed(1))
      : 0;

    const avgConsultationDurationMinutes = consultationAgg[0]
      ? Number(consultationAgg[0].avgConsultationMinutes.toFixed(1))
      : 0;

    const distinctCompletedDays = daysWithCompletionsAgg[0]?.distinctDays || 0;

    const patientsPerDay =
      distinctCompletedDays === 0
        ? 0
        : Number((completedAppointments / distinctCompletedDays).toFixed(2));

    let doctorUtilization = 0;

    if (doctorDoc) {
      const { totalSlots } = await getDoctorDaySlots(doctorDoc, todayStart);

      const bookedToday = await Appointment.countDocuments({
        doctorId,
        appointmentDate: { $gte: todayStart, $lte: todayEnd },
        status: { $ne: "Cancelled" },
      });

      doctorUtilization =
        totalSlots === 0
          ? 0
          : Number(((bookedToday / totalSlots) * 100).toFixed(2));
    }

    res.status(200).json({
      message: "Dashboard analytics fetched successfully",
      analytics: {
        totalAppointments,
        completedAppointments,
        cancelledAppointments,
        pendingAppointments,
        todayAppointments,
        weekAppointments,
        completionRate,
        avgWaitingTimeMinutes,
        avgConsultationDurationMinutes,
        patientsPerDay,
        doctorUtilization,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// DOCTOR DASHBOARD NEXT PATIENT
// ===========================
app.get("/doctor/dashboard/next-patient", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    // Today's IST boundaries (matches live-queue / check-in / start-consultation)
    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const todayStart = new Date(
      Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
    );

    const todayEnd = new Date(
      Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
    );

    const waitingPatients = await Appointment.find({
      doctorId,
      appointmentDate: {
        $gte: todayStart,
        $lte: todayEnd,
      },
      status: "Waiting",
      tokenNumber: {
        $ne: null,
      },
      // See the note on /doctor/live-queue: "next patient" must never be
      // someone who has not arrived. The two endpoints have to agree, so they
      // filter identically.
      checkedInAt: { $ne: null },
    });

    if (waitingPatients.length === 0) {
      return res.status(404).json({
        message: "No waiting patients found today",
      });
    }

    // Convert "09:30 AM" -> minutes since midnight
    const toMinutes = (slot) => {
      const [time, meridiem] = slot.split(" ");

      let [hours, minutes] = time.split(":").map(Number);

      if (meridiem.toLowerCase() === "pm" && hours !== 12) {
        hours += 12;
      }

      if (meridiem.toLowerCase() === "am" && hours === 12) {
        hours = 0;
      }

      return hours * 60 + minutes;
    };

    // Primary: Priority (a walk-in emergency must be called before a
    // routine patient booked earlier), then Appointment Time, then Token.
    waitingPatients.sort(byQueueOrder);

    const nextPatient = waitingPatients[0];

    res.status(200).json({
      message: "Next patient fetched successfully",
      patient: {
        _id: nextPatient._id,
        tokenNumber: nextPatient.tokenNumber,
        patientName: nextPatient.patientName,
        age: nextPatient.age,
        slot: nextPatient.slot,
        symptoms: nextPatient.symptoms,
        bloodGroup: nextPatient.bloodGroup,
        medicalConditions: nextPatient.medicalConditions,
        currentMedications: nextPatient.currentMedications,
        priority: nextPatient.priority,
        status: nextPatient.status,
      },
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// START CONSULTATION
// ===========================
app.patch(
  "/doctor/appointments/:id/start-consultation",
  auth,
  async (req, res) => {
    try {
      const doctorId = req.doctor.doctorId;
      const { id } = req.params;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          message: "Invalid appointment ID",
        });
      }

      const appointment = await Appointment.findById(id);

      if (!appointment) {
        return res.status(404).json({
          message: "Appointment not found",
        });
      }

      if (appointment.doctorId.toString() !== doctorId) {
        return res.status(403).json({
          message:
            "You are not authorized to start this consultation",
        });
      }

      const now = new Date();
      const IST_OFFSET = 5.5 * 60 * 60 * 1000;
      const istNow = new Date(now.getTime() + IST_OFFSET);

      const year = istNow.getUTCFullYear();
      const month = istNow.getUTCMonth();
      const day = istNow.getUTCDate();

      const todayStart = new Date(
        Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
      );

      const todayEnd = new Date(
        Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
      );

      if (
        appointment.appointmentDate < todayStart ||
        appointment.appointmentDate > todayEnd
      ) {
        return res.status(400).json({
          message:
            "Only today's appointments can be started",
        });
      }

      if (
        appointment.tokenNumber === null ||
        appointment.tokenNumber === undefined
      ) {
        return res.status(400).json({
          message:
            "Patient must be checked in before consultation",
        });
      }

      if (appointment.status !== "Waiting") {
        return res.status(400).json({
          message: `Cannot start consultation. Current status is ${appointment.status}`,
        });
      }

      const activeConsultation = await Appointment.findOne({
        doctorId,
        status: "In Consultation",
        _id: {
          $ne: appointment._id,
        },
      });

      if (activeConsultation) {
        return res.status(400).json({
          message: `${activeConsultation.patientName} is already in consultation`,
        });
      }

      appointment.status = "In Consultation";
      appointment.consultationStartedAt = new Date();

      await appointment.save();

      io.emit("queueUpdated", {
        appointmentId: appointment._id,
        tokenNumber: appointment.tokenNumber,
        status: appointment.status,
        event: "consultation-started",
      });

      res.status(200).json({
        message: "Consultation started successfully",
        appointment,
      });
    } catch (error) {
      res.status(500).json({
        message: error.message,
      });
    }
  }
);

// ===========================
// SET ESTIMATED CONSULTATION DURATION
// The doctor's own per-patient time estimate, set once they've actually
// seen the patient - refines the wait estimate shown to everyone behind
// them in the queue (see GET /waiting-room/:doctorId/:tokenNumber) beyond
// the flat clinic-wide average.
// ===========================
app.patch(
  "/doctor/appointments/:id/estimated-duration",
  auth,
  async (req, res) => {
    try {
      const doctorId = req.doctor.doctorId;
      const { id } = req.params;
      const { estimatedDurationMinutes } = req.body;

      if (!mongoose.Types.ObjectId.isValid(id)) {
        return res.status(400).json({
          message: "Invalid appointment ID",
        });
      }

      const minutes = Number(estimatedDurationMinutes);

      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 180) {
        return res.status(400).json({
          message: "Estimated duration must be a number of minutes between 1 and 180",
        });
      }

      const appointment = await Appointment.findById(id);

      if (!appointment) {
        return res.status(404).json({
          message: "Appointment not found",
        });
      }

      if (appointment.doctorId.toString() !== doctorId) {
        return res.status(403).json({
          message: "You are not authorized to update this appointment",
        });
      }

      if (!["Waiting", "In Consultation"].includes(appointment.status)) {
        return res.status(400).json({
          message: "Estimated duration can only be set while the patient is waiting or in consultation",
        });
      }

      appointment.estimatedDurationMinutes = Math.round(minutes);
      await appointment.save();

      const io = req.app.get("io");

      if (io) {
        io.emit("queueUpdated", {
          appointmentId: appointment._id,
          doctorId: appointment.doctorId,
          tokenNumber: appointment.tokenNumber,
          status: appointment.status,
          event: "estimated-duration-updated",
        });
      }

      res.status(200).json({
        message: "Estimated duration updated successfully",
        appointment,
      });
    } catch (error) {
      res.status(500).json({
        message: error.message,
      });
    }
  }
);

// ===========================
// LIVE QUEUE
// ===========================
app.get("/doctor/live-queue", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const todayStart = new Date(
      Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
    );

    const todayEnd = new Date(
      Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
    );

    const appointments = await Appointment.find({
      doctorId,
      appointmentDate: {
        $gte: todayStart,
        $lte: todayEnd,
      },
      status: {
        $in: [
          "Waiting",
          "In Consultation",
          "Completed",
        ],
      },
      tokenNumber: {
        $ne: null,
      },
      // ARRIVAL, not a token. Tokens are issued at BOOKING, so filtering only
      // on tokenNumber put every patient booked for today in the doctor's
      // queue whether or not they were in the building - the doctor could be
      // sent to call someone who had not arrived, and a no-show sat in the
      // queue until reception noticed.
      //
      // This is the same "a token means the patient arrived" assumption that
      // was fixed in the frontend (queueStatus.js) and in the stale-expiry
      // routine; the doctor's own queue was the last place still holding it.
      checkedInAt: { $ne: null },
    });

    // Convert slot to minutes for sorting
    const toMinutes = (slot) => {
      const [time, meridiem] = slot.split(" ");

      let [hours, minutes] = time
        .split(":")
        .map(Number);

      if (
        meridiem.toLowerCase() === "pm" &&
        hours !== 12
      ) {
        hours += 12;
      }

      if (
        meridiem.toLowerCase() === "am" &&
        hours === 12
      ) {
        hours = 0;
      }

      return hours * 60 + minutes;
    };

    // Priority first, then appointment time, then token - same rule the
    // waiting-room board and "next patient" use, so all three agree.
    appointments.sort(byQueueOrder);

    const queue = appointments.map((appointment) => ({
      _id: appointment._id,
      name: appointment.patientName,
      patientName: appointment.patientName,
      tokenNumber: appointment.tokenNumber,
      priority: appointment.priority || "Normal",
      status: appointment.status,
      slot: appointment.slot,
      appointmentDate: appointment.appointmentDate,
    }));

    res.status(200).json(queue);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// GET DOCTORS BY SPECIALIZATION
// ===========================
app.get(
  "/doctors/specialization/:specialization",
  async (req, res) => {
    try {
      const specialization =
        req.params.specialization?.trim();

      if (!specialization) {
        return res.status(400).json({
          message:
            "Specialization is required",
        });
      }

      const safePattern =
        escapeRegex(specialization);

      const doctors = await Doctor.find({
        specialization: {
          $regex: `^${safePattern}$`,
          $options: "i",
        },
        isAvailable: true,
      })
        .select("-password")
        .sort({
          name: 1,
        });

      if (doctors.length === 0) {
        return res.status(404).json({
          message:
            "No doctors found for this specialization",
        });
      }

      const enrichedDoctors = await Promise.all(
        doctors.map(async (doc) => {
          const availability = await computeDoctorAvailability(
            doc,
            doc.workingDays
          );
          return {
            ...doc.toObject(),
            workingDays: doc.workingDays?.length
              ? doc.workingDays
              : DEFAULT_WORKING_DAYS,
            ...availability,
          };
        })
      );

      res.status(200).json({
        message:
          "Doctors fetched successfully",
        count: enrichedDoctors.length,
        doctors: enrichedDoctors,
      });
    } catch (error) {
      console.error(
        "Error fetching doctors by specialization:",
        error
      );

      res.status(500).json({
        message:
          "Server error while fetching doctors",
      });
    }
  }
);
// ===========================
// GET DOCTORS BY LOCATION
// ===========================
app.get("/doctors/location/:location", async (req, res) => {
  try {
    const location = req.params.location?.trim();

    if (!location) {
      return res.status(400).json({
        message: "Location is required",
      });
    }

    const safePattern = escapeRegex(location);

    const doctors = await Doctor.find({
      location: {
        $regex: `^${safePattern}$`,
        $options: "i",
      },
      isAvailable: true,
    })
      .select("-password")
      .sort({ name: 1 });

    if (doctors.length === 0) {
      return res.status(404).json({
        message: "No doctors found in this location",
      });
    }

    const enrichedDoctors = await Promise.all(
      doctors.map(async (doc) => {
        const availability = await computeDoctorAvailability(
          doc,
          doc.workingDays
        );
        return {
          ...doc.toObject(),
          workingDays: doc.workingDays?.length
            ? doc.workingDays
            : DEFAULT_WORKING_DAYS,
          ...availability,
        };
      })
    );

    res.status(200).json({
      message: "Doctors fetched successfully",
      count: enrichedDoctors.length,
      doctors: enrichedDoctors,
    });
  } catch (error) {
    console.error("Error fetching doctors by location:", error);

    res.status(500).json({
      message: "Server error while fetching doctors",
    });
  }
});

// ===========================
// BOOK APPOINTMENT
// ===========================
app.post("/appointments", async (req, res) => {
  try {
    const {
      doctorId,
      patientName,
      age,
      phone,
      bloodGroup,
      medicalConditions,
      currentMedications,
      symptoms,
      appointmentDate,
      slot,
    } = req.body;

    if (
      !doctorId ||
      !patientName?.trim() ||
      age === undefined ||
      age === null ||
      age === "" ||
      !phone?.trim() ||
      !appointmentDate ||
      !slot ||
      !symptoms?.trim()
    ) {
      return res.status(400).json({
        message: "Please fill all required fields",
      });
    }

    // Reject non-numeric or non-positive age separately from "missing" above,
    // so a blank age field (coerced to 0 by the frontend's Number("")) can't
    // silently pass as valid - it must be an explicit, real age.
    if (!Number.isFinite(Number(age)) || Number(age) <= 0) {
      return res.status(400).json({
        message: "Please enter a valid age",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({
        message: "Invalid doctor ID",
      });
    }

    const trimmedPhone = phone.trim();

    if (!/^[6-9]\d{9}$/.test(trimmedPhone)) {
      return res.status(400).json({
        message: "Invalid phone number. Must be a valid 10-digit Indian mobile number.",
      });
    }

    const doctor = await Doctor.findById(doctorId);

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    if (!doctor.isAvailable) {
      return res.status(400).json({
        message: "Doctor is currently unavailable for appointments",
      });
    }

    let appointmentDay = new Date(appointmentDate);

    if (isNaN(appointmentDay.getTime())) {
      return res.status(400).json({
        message: "Invalid appointment date",
      });
    }

    // The IST calendar day, matching what the model stores (see its
    // pre-save hook). setHours resolved in the SERVER's timezone, so on
    // Render every one of these was a different instant from the value
    // actually written to the database - the comparison below rejected a
    // valid same-day booking in the small hours, and the two lookups that
    // follow queried a day the appointments were not on.
    appointmentDay = normalizeToIstDay(appointmentDay);

    const today = getISTDayRange(new Date()).todayStart;

    if (appointmentDay.getTime() < today.getTime()) {
      return res.status(400).json({
        message: "Appointment date cannot be in the past",
      });
    }

    const { todayStart: dayStart, todayEnd: dayEnd } =
      getISTDayRange(appointmentDay);

    // Validate slot belongs to doctor's schedule
    const validSlots = generateSlots(
      doctor.workingHours.start,
      doctor.workingHours.end,
      doctor.slotDuration
    );

    if (!validSlots.includes(slot)) {
      return res.status(400).json({
        message: "Invalid appointment slot",
      });
    }

    // Check blocked slots
    const blocked = await BlockedSlot.findOne({
      doctorId,
      date: {
        $gte: dayStart,
        $lte: dayEnd,
      },
      $or: [
        { isFullDay: true },
        {
          isFullDay: false,
          slot,
        },
      ],
    });

    if (blocked) {
      return res.status(409).json({
        message: "Selected slot is unavailable",
      });
    }

    // Check booked slot
    const existingAppointment = await Appointment.findOne({
      doctorId,
      appointmentDate: {
        $gte: dayStart,
        $lte: dayEnd,
      },
      slot,
      status: {
        $ne: "Cancelled",
      },
    });

    if (existingAppointment) {
      return res.status(409).json({
        message: "This slot is already booked.",
      });
    }

    // Find or create the permanent Patient record for this phone number.
    // Patient.bloodGroup is a strict enum, but incoming bloodGroup here is
    // unconstrained free text from the booking form - only pass it through
    // if it's a value Patient actually accepts, otherwise a mismatched or
    // empty value would throw and break booking entirely.
    const VALID_BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
    let patientDoc;

    try {
      patientDoc = await Patient.findOne({ phone: trimmedPhone });

      if (!patientDoc) {
        const newPatientData = {
          name: patientName.trim(),
          phone: trimmedPhone,
        };

        if (bloodGroup && VALID_BLOOD_GROUPS.includes(bloodGroup)) {
          newPatientData.bloodGroup = bloodGroup;
        }

        patientDoc = await Patient.create(newPatientData);
      } else if (patientDoc.name !== patientName.trim()) {
        // Keep the permanent record's name current if it changed since
        // their last visit, without touching fields this form doesn't collect.
        patientDoc.name = patientName.trim();
        await patientDoc.save();
      }
    } catch (patientError) {
      if (patientError.code === 11000) {
        return res.status(409).json({
          message: "A patient record with this phone number already exists.",
        });
      }
      return res.status(400).json({
        message: `Could not create patient record: ${patientError.message}`,
      });
    }

    const appointment = new Appointment({
      doctorId,
      patient: patientDoc._id,
      patientName: patientName.trim(),
      age: Number(age),
      phone: trimmedPhone,
      bloodGroup,
      medicalConditions,
      currentMedications,
      symptoms,
      appointmentDate: appointmentDay,
      slot,
    });

    // Assign the queue token at booking time, not only at check-in.
    //
    // Previously tokenNumber stayed null until reception checked the patient
    // in, and every queue view filters on tokenNumber != null. A patient who
    // had just booked was therefore invisible in the doctor's live queue, and
    // could not open their own waiting-room page at all (its route is
    // /waiting-room/:doctorId/:tokenNumber - there was no token to route on).
    //
    // Tokens are per doctor per day, so this is the same sequence check-in
    // used; check-in now finds a token already present and leaves it alone.
    // The unique (doctorId, appointmentDate, tokenNumber) index is the
    // backstop for two people booking at once - on a duplicate key we simply
    // recompute and retry.
    // Matched against the normalized value the model actually stores, not
    // against appointmentDay: that is built with setHours, which resolves in
    // the server's timezone, so on a UTC host (Render) it never equalled the
    // IST-normalized stored date. The lookup then found no previous token,
    // reissued one already held by a cancelled appointment on that day, and
    // the duplicate-key error surfaced as "This slot is already booked."
    await saveWithToken(Appointment, appointment, appointmentDay);

    const io = req.app.get("io");

    if (io) {
      io.emit("queueUpdated", {
        appointmentId: appointment._id,
        doctorId: appointment.doctorId,
        status: appointment.status,
        event: "new-booking",
      });
    }

    // Not awaited: the appointment is already saved, and mail must never
    // delay or fail the booking response.
    sendBookingConfirmation(appointment).catch(() => {});

    res.status(201).json({
      message: "Appointment booked successfully",
      bookingId: appointment.bookingId,
      appointment,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "This slot is already booked.",
      });
    }

    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// GET PATIENT APPOINTMENTS BY PHONE
// ===========================
// Backs the doctor-only Patient History page (/patient-history/:phone).
// Previously unauthenticated, so any phone number returned that patient's
// full record - name, age, blood group, conditions, symptoms - to anyone.
app.get("/appointments/patient/:phone", auth, async (req, res) => {
  try {
    const phone = req.params.phone?.trim();

    if (!phone) {
      return res.status(400).json({
        message: "Phone number is required",
      });
    }

    const appointments = await Appointment.find({
      phone,
    })
      .populate(
        "doctorId",
        "name specialization location"
      )
      .sort({
        appointmentDate: -1,
        createdAt: -1,
      });

    res.status(200).json({
      message: "Patient appointments fetched successfully",
      appointments: appointments.map(sanitizeAppointmentForPatient),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// GET APPOINTMENTS BY DOCTOR
// ===========================
app.get("/appointments/my", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    const doctor = await Doctor.findById(doctorId);

    if (!doctor) {
      return res.status(404).json({
        message: "Doctor not found",
      });
    }

    const query = {
      doctorId,
    };

    if (req.query.status) {
      query.status = req.query.status;
    }

    if (req.query.patientName) {
      query.patientName = {
        $regex: req.query.patientName,
        $options: "i",
      };
    }

    if (req.query.phone) {
      query.phone = {
        $regex: req.query.phone.trim(),
        $options: "i",
      };
    }

    if (req.query.range || req.query.startDate || req.query.endDate) {
      try {
        const filter = getDateRangeFilter({
          range: req.query.range,
          startDate: req.query.startDate,
          endDate: req.query.endDate,
        });

        if (filter) {
          query.appointmentDate = filter;
        }
      } catch (rangeError) {
        return res.status(400).json({
          message: rangeError.message,
        });
      }
    } else if (req.query.date) {
      let dayStart = new Date(req.query.date);

      if (isNaN(dayStart.getTime())) {
        return res.status(400).json({
          message: "Invalid date format",
        });
      }

      // Same IST day window the appointments are stored on; a setHours
      // range silently listed the neighbouring day on a UTC host.
      ({ todayStart: dayStart, todayEnd: dayEnd } = getISTDayRange(dayStart));

      query.appointmentDate = {
        $gte: dayStart,
        $lte: dayEnd,
      };
    }

    const appointments = await Appointment.find(query);

    const toMinutes = (slot) => {
      const [time, meridiem] = slot.split(" ");

      let [hours, minutes] = time
        .split(":")
        .map(Number);

      if (
        meridiem.toLowerCase() === "pm" &&
        hours !== 12
      ) {
        hours += 12;
      }

      if (
        meridiem.toLowerCase() === "am" &&
        hours === 12
      ) {
        hours = 0;
      }

      return hours * 60 + minutes;
    };

    appointments.sort((a, b) => {
      const dateDiff =
        new Date(a.appointmentDate) -
        new Date(b.appointmentDate);

      if (dateDiff !== 0) {
        return dateDiff;
      }

      const slotDiff =
        toMinutes(a.slot) - toMinutes(b.slot);

      if (slotDiff !== 0) {
        return slotDiff;
      }

      return (
        (a.tokenNumber || 0) -
        (b.tokenNumber || 0)
      );
    });

    res.status(200).json({
      message: "Appointments fetched successfully",
      totalAppointments: appointments.length,
      appointments,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// UPDATE APPOINTMENT
// ===========================
app.patch("/appointments/:id", auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const {
      diagnosis,
      prescription,
      notes,
      status,
    } = req.body;

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    if (appointment.doctorId.toString() !== req.doctor.doctorId) {
      return res.status(403).json({
        message: "You are not authorized to update this appointment",
      });
    }

    if (status) {
      const validStatuses = [
        "Waiting",
        "In Consultation",
        "Completed",
        "Cancelled",
      ];

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid appointment status",
        });
      }

      // Both sides on the IST day, so "is this appointment in the future"
      // means the same thing on a UTC host as it does locally.
      const appointmentDay = normalizeToIstDay(appointment.appointmentDate);
      const today = getISTDayRange(new Date()).todayStart;

      if (
        (status === "In Consultation" ||
          status === "Completed") &&
        appointmentDay > today
      ) {
        return res.status(400).json({
          message:
            "Future appointments cannot be started or completed.",
        });
      }

      // Prevent Waiting -> Completed
      if (
        status === "Completed" &&
        appointment.status !== "In Consultation"
      ) {
        return res.status(400).json({
          message:
            "Consultation must be started before it can be completed.",
        });
      }

      // A consultation cannot be marked Completed with no medical record -
      // that produced the exact bug this guards against: patients seeing
      // "Completed" alongside "Diagnosis: Not provided" / "Prescription: Not
      // provided", with the report download already enabled. Check the
      // EFFECTIVE value (this request's field if provided, otherwise
      // whatever's already saved), since diagnosis/prescription may arrive
      // in the same PATCH as the status change or may already be saved from
      // an earlier "Save Draft" call.
      if (status === "Completed") {
        const effectiveDiagnosis =
          diagnosis !== undefined ? diagnosis : appointment.diagnosis;
        const effectivePrescription =
          prescription !== undefined ? prescription : appointment.prescription;

        if (!effectiveDiagnosis?.trim()) {
          return res.status(400).json({
            message: "Diagnosis is required before completing consultation.",
          });
        }

        if (!effectivePrescription?.trim()) {
          return res.status(400).json({
            message: "Prescription is required before completing consultation.",
          });
        }
      }

      // Prevent Completed -> Cancelled
      if (
        appointment.status === "Completed" &&
        status === "Cancelled"
      ) {
        return res.status(400).json({
          message:
            "Completed appointments cannot be cancelled.",
        });
      }
    }

    if (diagnosis !== undefined) {
      appointment.diagnosis = diagnosis;
    }

    if (notes !== undefined) {
      appointment.notes = notes;
    }

    if (prescription !== undefined) {
      appointment.prescription = prescription;
    }

    if (status !== undefined) {
      appointment.status = status;

      if (status === "Cancelled" && !appointment.cancelledAt) {
        appointment.cancelledAt = new Date();
      }
    }

    await appointment.save();

    const io = req.app.get("io");

    if (io && status !== undefined) {
      io.emit("queueUpdated", {
        appointmentId: appointment._id,
        doctorId: appointment.doctorId,
        tokenNumber: appointment.tokenNumber,
        status: appointment.status,
        event:
          status === "Completed"
            ? "consultation-completed"
            : status === "Cancelled"
            ? "cancelled"
            : "updated",
      });
    }

    res.status(200).json({
      message: "Appointment updated successfully",
      appointment,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// RECEPTIONIST CHECK-IN
// ===========================
app.patch("/appointments/:id/check-in", auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    if (appointment.doctorId.toString() !== req.doctor.doctorId) {
      return res.status(403).json({
        message:
          "You are not authorized to check in this appointment",
      });
    }

    if (appointment.status === "Cancelled") {
      return res.status(400).json({
        message: "Cancelled appointments cannot be checked in",
      });
    }

    const { priority = "Normal" } = req.body;

    if (!["High", "Normal", "Low"].includes(priority)) {
      return res.status(400).json({
        message: "Invalid priority",
      });
    }

    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const todayStart = new Date(
      Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
    );

    const todayEnd = new Date(
      Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
    );

    if (
      appointment.appointmentDate < todayStart ||
      appointment.appointmentDate > todayEnd
    ) {
      return res.status(400).json({
        message:
          "Only today's appointments can be checked in",
      });
    }

    if (appointment.tokenNumber !== null) {
      return res.status(400).json({
        message: "Patient is already checked in",
      });
    }

    const lastTokenAppointment = await Appointment.findOne({
      doctorId: appointment.doctorId,
      appointmentDate: {
        $gte: todayStart,
        $lte: todayEnd,
      },
      tokenNumber: {
        $ne: null,
      },
      status: {
        $ne: "Cancelled",
      },
    }).sort({
      tokenNumber: -1,
    });

    appointment.tokenNumber = lastTokenAppointment
      ? lastTokenAppointment.tokenNumber + 1
      : 1;

    appointment.priority = priority;
    appointment.status = "Waiting";
    appointment.checkedInAt = new Date();

    await appointment.save();

    const io = req.app.get("io");

    if (io) {
      io.emit("queueUpdated", {
        appointmentId: appointment._id,
        doctorId: appointment.doctorId,
        tokenNumber: appointment.tokenNumber,
        status: appointment.status,
        event: "checked-in",
      });
    }

    res.status(200).json({
      message: "Patient checked in successfully",
      appointment,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// DOWNLOAD PRESCRIPTION PDF
// ===========================
function streamConsultationPdf(res, appointment, doctorName) {
  const doc = new PDFDocument({
    margin: 50,
  });

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=Prescription-${appointment.bookingId}.pdf`
  );

  doc.pipe(res);

  // ===========================
  // HEADER
  // ===========================
  doc.fontSize(22).text("MediFlow Prescription", {
    align: "center",
  });

  doc.moveDown();

  doc.fontSize(12).text(
    `Generated On : ${new Date().toLocaleDateString("en-IN")}`
  );

  doc.moveDown();

  // ===========================
  // DOCTOR DETAILS
  // ===========================
  doc.fontSize(14).text("Doctor Information", {
    underline: true,
  });

  doc.fontSize(12);
  doc.text(`Doctor : ${doctorName || "Unknown"}`);

  doc.moveDown();

  // ===========================
  // PATIENT DETAILS
  // ===========================
  doc.fontSize(14).text("Patient Information", {
    underline: true,
  });

  doc.fontSize(12);
  doc.text(`Patient : ${appointment.patientName}`);
  doc.text(`Booking ID : ${appointment.bookingId}`);
  doc.text(
    `Appointment Date : ${new Date(
      appointment.appointmentDate
    ).toLocaleDateString("en-IN")}`
  );
  doc.text(`Appointment Slot : ${appointment.slot}`);
  doc.text(`Age : ${appointment.age}`);
  doc.text(
    `Blood Group : ${appointment.bloodGroup || "Not provided"}`
  );

  doc.moveDown();

  // ===========================
  // MEDICAL DETAILS
  // ===========================
  doc.fontSize(14).text("Medical Details", {
    underline: true,
  });

  doc.fontSize(12);
  doc.text(
    `Symptoms : ${appointment.symptoms || "Not provided"}`
  );

  doc.moveDown();

  doc.text("Diagnosis:");
  doc.text(appointment.diagnosis || "Not provided");

  doc.moveDown();

  doc.text("Notes:");
  doc.text(appointment.notes || "Not provided");

  doc.moveDown();

  doc.text("Prescription:");
  doc.text(appointment.prescription || "Not provided");

  doc.moveDown(2);

  // ===========================
  // FOOTER
  // ===========================
  doc.fontSize(10);
  doc.text(
    "This prescription was generated by MediFlow.",
    {
      align: "center",
    }
  );

  doc.end();
}

app.get("/appointments/:id/pdf", auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    if (!appointment.doctorId.equals(req.doctor.doctorId)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    // doctorName no longer stored on Appointment (removed as duplicate
    // data - see Doctor.name via doctorId, the single source of truth).
    // Looked up separately, after the auth check above, so the existing
    // ObjectId.equals() comparison there is untouched.
    const prescribingDoctor = await Doctor.findById(appointment.doctorId).select("name");

    streamConsultationPdf(res, appointment, prescribingDoctor?.name);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// GET PATIENT MEDICAL REPORT (PDF)
// ===========================
// Requires a patient token. The phone the appointment is matched against comes
// from that token, never from the request - an earlier version accepted it as
// a query parameter and had no auth at all, so anyone who knew an appointment
// id and a phone number could pull someone else's diagnosis and prescription.
// It lives under /patient so the frontend's interceptor attaches the patient
// token; the /appointments prefix is mapped to the doctor token.
app.get("/patient/appointments/:id/report", patientAuth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid appointment ID" });
    }

    const patient = await Patient.findById(req.patient.patientId).select("phone");
    if (!patient) {
      return res.status(404).json({ message: "Patient not found" });
    }

    const appointment = await Appointment.findById(req.params.id);
    if (!appointment) {
      return res.status(404).json({ message: "Appointment not found" });
    }

    if (appointment.phone !== patient.phone) {
      return res.status(403).json({ message: "Access denied" });
    }

    // status === "Completed" now implies diagnosis/prescription are present
    // for every NEW completion (enforced in PATCH /appointments/:id above),
    // but this also guards any appointment completed before that validation
    // existed - the download must never hand out a report with no actual
    // medical record in it.
    if (
      appointment.status !== "Completed" ||
      !appointment.diagnosis?.trim() ||
      !appointment.prescription?.trim()
    ) {
      return res.status(400).json({
        message: "Medical report is available once the consultation is finalized by the doctor",
      });
    }

    const prescribingDoctor = await Doctor.findById(appointment.doctorId).select("name");
    streamConsultationPdf(res, appointment, prescribingDoctor?.name);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// ===========================
// RESCHEDULE APPOINTMENT
// ===========================
app.patch("/appointments/:id/reschedule", auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const doctorId = req.doctor.doctorId;
    const { appointmentDate, slot } = req.body;

    if (!appointmentDate || !slot) {
      return res.status(400).json({
        message: "appointmentDate and slot are required",
      });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    if (!appointment.doctorId.equals(doctorId)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    let appointmentDay = new Date(appointmentDate);

    if (isNaN(appointmentDay.getTime())) {
      return res.status(400).json({
        message: "Invalid appointment date",
      });
    }

    // As in the booking route above: the IST calendar day, matching what
    // the model stores.
    appointmentDay = normalizeToIstDay(appointmentDay);

    const today = getISTDayRange(new Date()).todayStart;

    if (appointmentDay.getTime() < today.getTime()) {
      return res.status(400).json({
        message: "Cannot reschedule to a past date",
      });
    }

    const { todayStart: dayStart, todayEnd: dayEnd } =
      getISTDayRange(appointmentDay);

    // Check blocked slot
    const blocked = await BlockedSlot.findOne({
      doctorId,
      date: {
        $gte: dayStart,
        $lte: dayEnd,
      },
      $or: [
        { isFullDay: true },
        {
          isFullDay: false,
          slot,
        },
      ],
    });

    if (blocked) {
      return res.status(409).json({
        message: "Selected slot is unavailable",
      });
    }

    // Check booked slot
    const existingAppointment = await Appointment.findOne({
      _id: {
        $ne: appointment._id,
      },
      doctorId,
      appointmentDate: {
        $gte: dayStart,
        $lte: dayEnd,
      },
      slot,
      status: {
        $ne: "Cancelled",
      },
    });

    if (existingAppointment) {
      return res.status(409).json({
        message: "Selected slot is already booked",
      });
    }

    appointment.appointmentDate = appointmentDay;
    appointment.slot = slot;

    await appointment.save();

    res.status(200).json({
      message: "Appointment rescheduled successfully",
      appointment,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "Selected slot is already booked",
      });
    }

    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// DOCTOR DASHBOARD MONTHLY ANALYTICS
// ===========================
app.get("/doctor/dashboard/monthly", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    // Last 12 months (starting from the first day of the month)
    let lastYear = new Date();
    lastYear.setMonth(lastYear.getMonth() - 11);
    lastYear.setDate(1);
    // Anchored to the IST day so the twelve-month window does not shift by
    // half a day depending on where the process runs.
    lastYear = normalizeToIstDay(lastYear);

    const monthlyData = await Appointment.aggregate([
      {
        $match: {
          doctorId: new mongoose.Types.ObjectId(doctorId),
          appointmentDate: {
            $gte: lastYear,
          },
        },
      },
      {
        $group: {
          _id: {
            year: { $year: "$appointmentDate" },
            month: { $month: "$appointmentDate" },
          },

          totalAppointments: {
            $sum: 1,
          },

          completedAppointments: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Completed"] },
                1,
                0,
              ],
            },
          },

          cancelledAppointments: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Cancelled"] },
                1,
                0,
              ],
            },
          },

          waitingAppointments: {
            $sum: {
              $cond: [
                { $eq: ["$status", "Waiting"] },
                1,
                0,
              ],
            },
          },

          inConsultationAppointments: {
            $sum: {
              $cond: [
                { $eq: ["$status", "In Consultation"] },
                1,
                0,
              ],
            },
          },
        },
      },
      {
        $sort: {
          "_id.year": 1,
          "_id.month": 1,
        },
      },
    ]);

    const monthNames = [
      "",
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];

    const analytics = monthlyData.map((item) => ({
      month: monthNames[item._id.month],
      year: item._id.year,

      totalAppointments: item.totalAppointments,
      completedAppointments: item.completedAppointments,
      cancelledAppointments: item.cancelledAppointments,
      waitingAppointments: item.waitingAppointments,
      inConsultationAppointments:
        item.inConsultationAppointments,

      completionRate:
        item.totalAppointments === 0
          ? 0
          : Number(
              (
                (item.completedAppointments /
                  item.totalAppointments) *
                100
              ).toFixed(2)
            ),
    }));

    res.status(200).json({
      message: "Monthly analytics fetched successfully",
      analytics,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});
// ===========================
// EXPORT TODAY'S APPOINTMENTS
// ===========================
app.get("/doctor/export/today", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    // Today's IST boundaries (matches live-queue / check-in / start-consultation)
    const now = new Date();
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + IST_OFFSET);

    const year = istNow.getUTCFullYear();
    const month = istNow.getUTCMonth();
    const day = istNow.getUTCDate();

    const todayStart = new Date(
      Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
    );

    const todayEnd = new Date(
      Date.UTC(year, month, day, 23, 59, 59, 999) - IST_OFFSET
    );

    const appointments = await Appointment.find({
      doctorId,
      appointmentDate: {
        $gte: todayStart,
        $lte: todayEnd,
      },
    });

    if (appointments.length === 0) {
      return res.status(404).json({
        message: "No appointments found for today",
      });
    }

    const toMinutes = (slot) => {
      const [time, meridiem] = slot.split(" ");

      let [hours, minutes] = time.split(":").map(Number);

      if (meridiem.toLowerCase() === "pm" && hours !== 12) {
        hours += 12;
      }

      if (meridiem.toLowerCase() === "am" && hours === 12) {
        hours = 0;
      }

      return hours * 60 + minutes;
    };

    // Appointment time first, token second
    appointments.sort((a, b) => {
      const slotDiff = toMinutes(a.slot) - toMinutes(b.slot);

      if (slotDiff !== 0) {
        return slotDiff;
      }

      return (a.tokenNumber || 0) - (b.tokenNumber || 0);
    });

    const csvStringifier = createObjectCsvStringifier({
      header: [
        { id: "bookingId", title: "Booking ID" },
        { id: "appointmentDate", title: "Appointment Date" },
        { id: "patientName", title: "Patient Name" },
        { id: "age", title: "Age" },
        { id: "phone", title: "Phone" },
        { id: "slot", title: "Appointment Slot" },
        { id: "tokenNumber", title: "Token" },
        { id: "priority", title: "Priority" },
        { id: "status", title: "Status" },
        { id: "symptoms", title: "Symptoms" },
        { id: "diagnosis", title: "Diagnosis" },
        { id: "prescription", title: "Prescription" },
        { id: "notes", title: "Notes" },
      ],
    });

    const csv =
      csvStringifier.getHeaderString() +
      csvStringifier.stringifyRecords(
        appointments.map((appointment) => ({
          bookingId: appointment.bookingId,
          appointmentDate: new Date(
            appointment.appointmentDate
          ).toLocaleDateString("en-IN"),
          patientName: appointment.patientName,
          age: appointment.age,
          phone: appointment.phone,
          slot: appointment.slot,
          tokenNumber: appointment.tokenNumber ?? "-",
          priority: appointment.priority || "Normal",
          status: appointment.status,
          symptoms: appointment.symptoms || "",
          diagnosis: appointment.diagnosis || "",
          prescription: appointment.prescription || "",
          notes: appointment.notes || "",
        }))
      );

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="todays_appointments.csv"'
    );

    res.send(csv);
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// GET APPOINTMENT BY BOOKING ID
// ===========================
// Was unauthenticated. No frontend calls it, but it returned a full
// appointment to anyone holding (or guessing) a booking id.
app.get("/appointments/booking/:bookingId", patientAuth, async (req, res) => {
  try {
    const bookingId = req.params.bookingId?.trim();

    if (!bookingId) {
      return res.status(400).json({
        message: "Booking ID is required",
      });
    }

    const appointment = await Appointment.findOne({
      bookingId,
    });

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    // Ownership: a valid patient token must not be usable to read another
    // patient's booking. Matches GET /patient/appointments/:id/report.
    const caller = await Patient.findById(req.patient.patientId).select("phone");
    if (!caller || appointment.phone !== caller.phone) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.status(200).json({
      message: "Appointment fetched successfully",
      appointment: sanitizeAppointmentForPatient(appointment),
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// GET APPOINTMENT BY ID
// ===========================
app.get("/appointments/:id", auth, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({
        message: "Invalid appointment ID",
      });
    }

    const appointment = await Appointment.findById(req.params.id);

    if (!appointment) {
      return res.status(404).json({
        message: "Appointment not found",
      });
    }

    if (!appointment.doctorId.equals(req.doctor.doctorId)) {
      return res.status(403).json({
        message: "Access denied",
      });
    }

    res.status(200).json({
      message: "Appointment fetched successfully",
      appointment,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// SEARCH PATIENTS (Appointment System)
// ===========================
app.get("/patients/search", auth, async (req, res) => {
  try {
    const doctorId = req.doctor.doctorId;

    const { name, phone } = req.query;

    const query = { doctorId };

    if (name) {
      query.patientName = {
        $regex: name.trim(),
        $options: "i",
      };
    }

    if (phone) {
      query.phone = {
        $regex: phone.trim(),
        $options: "i",
      };
    }

    const patients = await Appointment.find(query)
      .select(
        "patientName age phone bloodGroup appointmentDate bookingId status"
      )
      .sort({
        appointmentDate: -1,
      });

    res.status(200).json({
      totalPatients: patients.length,
      patients,
    });
  } catch (error) {
    res.status(500).json({
      message: error.message,
    });
  }
});

// ===========================
// SOCKET.IO
// ===========================
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
  });
});