// Shared parsing/validation for the vitals the nurse records during clinical
// preparation. Lives here rather than in the controller because more than one
// endpoint accepts vitals and they must agree exactly on what counts as valid
// input.
//
// BMI is deliberately NOT computed here. It is derived once, in the
// Appointment pre-validate hook, so there is a single place it can come from.

// An empty string is how a form sends "left blank", and it means "do not
// record this", which is different from "record a zero".
function isBlank(value) {
  return value === undefined || value === null || value === "";
}

// Every optional measurement, with the bounds that catch a typo. The bounds
// exist to catch a slipped decimal point or a wrong unit (a Fahrenheit
// temperature, 1.7 m typed where 170 cm was meant), not to make a clinical
// judgement - an alarming but real reading must still be recordable. They are
// re-declared by the schema, which is the actual guarantee; checking here too
// means the caller gets a 400 with a clear message rather than a Mongoose
// validation error.
const MEASUREMENTS = [
  { field: "heightCm", label: "Height", min: 30, max: 275, unit: "cm", decimals: 1 },
  { field: "weightKg", label: "Weight", min: 1, max: 500, unit: "kg", decimals: 1 },
  { field: "bloodPressureSystolic", label: "Systolic pressure", min: 50, max: 300, unit: "mmHg", decimals: 0 },
  { field: "bloodPressureDiastolic", label: "Diastolic pressure", min: 20, max: 200, unit: "mmHg", decimals: 0 },
  { field: "temperatureC", label: "Temperature", min: 25, max: 45, unit: "°C", decimals: 1 },
  { field: "pulseBpm", label: "Pulse", min: 20, max: 250, unit: "bpm", decimals: 0 },
  { field: "spo2", label: "SpO2", min: 50, max: 100, unit: "%", decimals: 0 },
  { field: "respiratoryRate", label: "Respiratory rate", min: 5, max: 80, unit: "breaths/min", decimals: 0 },
];

// Measurements that are only meaningful as a pair. One without the other
// yields a half-filled panel the doctor cannot act on - no BMI, or a systolic
// reading with nothing to read it against - so it is rejected at the edge with
// a message naming the missing half rather than stored and silently rendered
// as blank.
const PAIRS = [
  ["heightCm", "weightKg", "Height", "Weight"],
  ["bloodPressureSystolic", "bloodPressureDiastolic", "Systolic pressure", "Diastolic pressure"],
];

const FIELDS = MEASUREMENTS.map((m) => m.field);

/**
 * @returns {{ ok: true, vitals: Record<string, number|null> }
 *          | { ok: false, message: string }}
 */
function parseVitals(input = {}) {
  const vitals = {};

  for (const spec of MEASUREMENTS) {
    if (isBlank(input[spec.field])) {
      vitals[spec.field] = null;
      continue;
    }

    const value = Number(input[spec.field]);

    if (!Number.isFinite(value)) {
      return { ok: false, message: `${spec.label} must be a number` };
    }

    if (value < spec.min || value > spec.max) {
      return {
        ok: false,
        message: `${spec.label} must be between ${spec.min} and ${spec.max} ${spec.unit}`,
      };
    }

    vitals[spec.field] = Number(value.toFixed(spec.decimals));
  }

  for (const [a, b, labelA, labelB] of PAIRS) {
    const aBlank = vitals[a] === null;
    const bBlank = vitals[b] === null;

    if (aBlank !== bBlank) {
      return {
        ok: false,
        message: aBlank
          ? `${labelA} is required when ${labelB.toLowerCase()} is recorded`
          : `${labelB} is required when ${labelA.toLowerCase()} is recorded`,
      };
    }
  }

  // A diastolic reading at or above the systolic one is a transposition, not a
  // patient state - catching it here is cheaper than a doctor reading it back
  // the wrong way round.
  if (
    vitals.bloodPressureSystolic !== null &&
    vitals.bloodPressureDiastolic >= vitals.bloodPressureSystolic
  ) {
    return {
      ok: false,
      message: "Systolic pressure must be higher than diastolic pressure",
    };
  }

  return { ok: true, vitals };
}

// True when every measurement came back blank, i.e. the caller is clearing
// the panel rather than recording anything.
function isEmptyVitals(vitals) {
  return FIELDS.every((field) => vitals[field] === null);
}

module.exports = { parseVitals, isEmptyVitals, VITAL_FIELDS: FIELDS };
