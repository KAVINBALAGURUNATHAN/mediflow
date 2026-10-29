// Same discipline as sanitizeAppointmentForPatient.js: readings and the
// interpretation only reach the patient once the result is actually
// finalised. A patient refreshing while values are still being entered
// would otherwise see a partial panel and read it as their full result.
function sanitizeLabResultForPatient(labResultDoc) {
  const obj = labResultDoc.toObject ? labResultDoc.toObject() : { ...labResultDoc };

  if (obj.status !== "Completed") {
    obj.values = [];
    obj.summary = "";
  }

  return obj;
}

module.exports = sanitizeLabResultForPatient;
