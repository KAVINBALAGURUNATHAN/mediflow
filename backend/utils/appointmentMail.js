const { sendMail, rows, button } = require("./mailer");
const Patient = require("../models/Patient");
const Doctor = require("../models/Doctor");
const Hospital = require("../models/Hospital");

// Appointment emails: confirmation, cancellation, reschedule.
//
// Every one of these is best-effort. They are fired without being awaited by
// the callers, and this module swallows its own errors, so a booking is never
// rejected because mail was slow or unavailable - the appointment is already
// saved by the time we get here.
//
// Nothing is invented: if a field is missing (no email on the patient record,
// no branch coordinates, no doctor populated) the row is simply omitted
// rather than filled with a placeholder.

function formatDate(date) {
  if (!date) return null;
  return new Date(date).toLocaleDateString("en-IN", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

// Guest bookings store the phone but not always an email, and the Patient
// record is the only place an address lives. Resolve it from there.
async function resolveRecipient(appointment) {
  if (!appointment?.phone) return null;
  const patient = await Patient.findOne({ phone: appointment.phone }).select("email name");
  const email = patient?.email?.trim();
  return email ? { email, name: patient.name || appointment.patientName } : null;
}

async function describe(appointment) {
  const doctor =
    appointment.doctorId?.name
      ? appointment.doctorId
      : await Doctor.findById(appointment.doctorId).select("name specialization location");

  // The branch is only shown when the doctor actually has one recorded.
  let branch = null;
  if (doctor?.location) {
    const hospital = await Hospital.findOne({
      $or: [{ branch: doctor.location }, { name: doctor.location }],
    }).select("name branch address phone");
    branch = hospital || null;
  }

  return { doctor, branch };
}

async function send({ appointment, subject, heading, intro, cta }) {
  try {
    const to = await resolveRecipient(appointment);
    if (!to) return { sent: false, reason: "no-email-on-record" };

    const { doctor, branch } = await describe(appointment);

    const detail = rows([
      ["Booking ID", appointment.bookingId],
      ["Doctor", doctor?.name ? `Dr ${doctor.name}`.replace(/^Dr Dr /, "Dr ") : null],
      ["Specialty", doctor?.specialization],
      ["Date", formatDate(appointment.appointmentDate)],
      ["Time", appointment.slot],
      ["Branch", branch ? (branch.branch ? `${branch.name} - ${branch.branch}` : branch.name) : doctor?.location],
      ["Patient", appointment.patientName],
    ]);

    const base = (process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");

    return await sendMail({
      to: to.email,
      subject,
      heading,
      bodyHtml: `
        <p style="margin:0 0 4px;font-size:14px;line-height:1.6;color:#475569;">${intro}</p>
        ${detail}
        ${cta ? `<p style="margin:0 0 20px;">${button(`${base}/my-appointments`, cta)}</p>` : ""}
        ${
          branch?.phone
            ? `<p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">Questions? Call the branch on ${branch.phone}.</p>`
            : ""
        }`,
    });
  } catch (error) {
    console.error("[appointmentMail] failed:", error.message);
    return { sent: false, reason: error.message };
  }
}

const sendBookingConfirmation = (appointment) =>
  send({
    appointment,
    subject: "Your appointment is confirmed",
    heading: "Appointment confirmed",
    intro: "Your appointment has been booked. Please arrive 15 minutes early and bring any relevant medical documents.",
    cta: "View my appointments",
  });

const sendCancellation = (appointment) =>
  send({
    appointment,
    subject: "Your appointment has been cancelled",
    heading: "Appointment cancelled",
    intro: "This appointment has been cancelled and the slot released. You can book again whenever you are ready.",
    cta: "Book another appointment",
  });

const sendReschedule = (appointment) =>
  send({
    appointment,
    subject: "Your appointment has been rescheduled",
    heading: "New appointment time",
    intro: "Your appointment has been moved. The new details are below - the previous time is no longer reserved.",
    cta: "View my appointments",
  });

module.exports = { sendBookingConfirmation, sendCancellation, sendReschedule };
