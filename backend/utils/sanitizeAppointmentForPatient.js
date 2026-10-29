// The medical record (diagnosis/prescription/notes) should only ever reach
// the patient once the doctor has actually finished writing it - otherwise
// a patient polling mid-consultation could see a half-typed diagnosis.
// Doctor- and receptionist-facing routes are unaffected (receptionist
// exposure is separately blocked at the query level via .select(), not here).
function sanitizeAppointmentForPatient(appointmentDoc) {
  const obj = appointmentDoc.toObject ? appointmentDoc.toObject() : { ...appointmentDoc };

  if (obj.status !== "Completed") {
    obj.diagnosis = "";
    obj.prescription = "";
    obj.notes = "";
  }

  return obj;
}

module.exports = sanitizeAppointmentForPatient;
