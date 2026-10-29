const mongoose = require("mongoose");

const appointmentSchema = new mongoose.Schema(
  {
    // Doctor Details
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
    },

    // Permanent identity record this visit belongs to.
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Patient",
      required: true,
    },

    // Patient Details (visit-time snapshot - kept alongside the `patient`
    // reference above rather than replaced by it, so existing routes that
    // read appointment.patientName/phone/etc. directly keep working
    // unchanged, and so this record preserves what was true AT THIS VISIT
    // even if the patient's permanent record changes later).
    patientName: {
      type: String,
      required: true,
      trim: true,
    },

    age: {
      type: Number,
      required: true,
      min: 0,
      max: 150,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      index: true,
      match: [/^[6-9]\d{9}$/, "Invalid phone number"],
    },

    bloodGroup: {
      type: String,
      enum: ["", "A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
      default: "",
    },

    medicalConditions: {
      type: String,
      trim: true,
      default: "",
    },

    currentMedications: {
      type: String,
      trim: true,
      default: "",
    },

    symptoms: {
      type: String,
      trim: true,
      default: "",
    },

    // Appointment Details
    appointmentDate: {
      type: Date,
      required: true,
    },

    slot: {
      type: String,
      required: true,
    },

    bookingId: {
      type: String,
      unique: true,
      required: true,
    },

    status: {
      type: String,
      enum: ["Waiting", "In Consultation", "Completed", "Cancelled"],
      default: "Waiting",
    },

    // Mirrors "this appointment is holding its slot", derived from status by
    // the pre-save hook below. It exists solely so the unique doctor/day/slot
    // index can be a partial index - MongoDB cannot express "status is not
    // Cancelled" in a partialFilterExpression, but it can match slotActive:
    // true. Set to false when cancelled, which drops the row out of the
    // partial index and frees the slot for rebooking.
    slotActive: {
      type: Boolean,
      default: true,
    },

    tokenNumber: {
      type: Number,
      default: null,
    },

    // Set automatically (see the pre-save hook below) the moment status
    // transitions to "Completed" - distinct from updatedAt, which changes
    // on every edit (diagnosis tweak, reschedule, etc.), not specifically
    // completion.
    completedAt: {
      type: Date,
      default: null,
    },

    // Set the moment tokenNumber is first assigned (i.e. check-in),
    // consultation start, and cancellation, respectively - same rationale
    // as completedAt above: distinct from updatedAt, and needed for
    // waiting-time / consultation-duration analytics.
    checkedInAt: {
      type: Date,
      default: null,
    },

    consultationStartedAt: {
      type: Date,
      default: null,
    },

    // Doctor's own estimate of how long THIS consultation will take, set
    // after they've actually seen the patient (not a fixed clinic-wide
    // average - see Settings.averageConsultationTime for that fallback).
    // Used to give people behind this patient in the queue a more accurate
    // wait estimate than the flat average, once the doctor has enough
    // information to judge it. Optional - most appointments never set this
    // and just fall back to the global average.
    estimatedDurationMinutes: {
      type: Number,
      default: null,
      min: 1,
      max: 180,
    },

    cancelledAt: {
      type: Date,
      default: null,
    },

    priority: {
      type: String,
      enum: ["High", "Normal", "Low"],
      default: "Normal",
    },

    // Why a patient was given priority - independent of the priority TIER
    // above, so reception can see/record the actual reason (not just that
    // someone is "High"). Setting a reason other than "" always implies
    // High priority (enforced in receptionistController.js), but the
    // reason itself is what's shown to staff/doctors as a tag.
    priorityReason: {
      type: String,
      enum: ["", "Senior Citizen", "Emergency", "Pregnant", "Disabled"],
      default: "",
    },

    // Doctor Updates
    diagnosis: {
      type: String,
      trim: true,
      default: "",
    },

    prescription: {
      type: String,
      trim: true,
      default: "",
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    // Vitals, recorded by the nurse during clinical preparation and read by
    // the doctor during the consultation. Stored on the appointment rather
    // than on the Patient because they are a measurement taken at one visit,
    // not a standing attribute - last month's weight must not overwrite
    // today's.
    //
    // Height/weight rows written before the nurse role existed were recorded
    // by a receptionist; recordedByModel says which collection recordedBy
    // points into, and is absent on those legacy rows.
    vitals: {
      // Ranges are deliberately wide: they exist to catch a slipped decimal
      // point or a centimetres/metres mix-up, not to make a clinical judgement.
      heightCm: {
        type: Number,
        min: [30, "Height must be at least 30 cm"],
        max: [275, "Height must be at most 275 cm"],
        default: null,
      },

      weightKg: {
        type: Number,
        min: [1, "Weight must be at least 1 kg"],
        max: [500, "Weight must be at most 500 kg"],
        default: null,
      },

      // Blood pressure is two readings that are only meaningful together, so
      // they are stored as two numbers and validated as a pair rather than as
      // a parsed "120/80" string that would have to be re-split everywhere it
      // is read.
      bloodPressureSystolic: {
        type: Number,
        min: [50, "Systolic pressure must be at least 50 mmHg"],
        max: [300, "Systolic pressure must be at most 300 mmHg"],
        default: null,
      },

      bloodPressureDiastolic: {
        type: Number,
        min: [20, "Diastolic pressure must be at least 20 mmHg"],
        max: [200, "Diastolic pressure must be at most 200 mmHg"],
        default: null,
      },

      // Celsius. The lower bound is below survivable, on purpose - these
      // bounds catch a Fahrenheit reading typed into a Celsius box, not a
      // genuinely hypothermic patient.
      temperatureC: {
        type: Number,
        min: [25, "Temperature must be at least 25 degrees C"],
        max: [45, "Temperature must be at most 45 degrees C"],
        default: null,
      },

      pulseBpm: {
        type: Number,
        min: [20, "Pulse must be at least 20 bpm"],
        max: [250, "Pulse must be at most 250 bpm"],
        default: null,
      },

      spo2: {
        type: Number,
        min: [50, "SpO2 must be at least 50%"],
        max: [100, "SpO2 must be at most 100%"],
        default: null,
      },

      // Breaths per minute. Unpaired, like temperature and pulse - it is a
      // reading that stands on its own, so recording it alone is valid and
      // must not force anything else to be taken.
      respiratoryRate: {
        type: Number,
        min: [5, "Respiratory rate must be at least 5 breaths per minute"],
        max: [80, "Respiratory rate must be at most 80 breaths per minute"],
        default: null,
      },

      // Always derived in the pre-validate hook below, never accepted from a
      // client. A BMI that disagrees with the height and weight shown beside
      // it is worse than no BMI at all, so there is exactly one place that
      // can compute it.
      bmi: {
        type: Number,
        default: null,
      },

      recordedAt: {
        type: Date,
        default: null,
      },

      // Intentionally a bare ObjectId rather than a refPath: legacy rows have
      // recordedBy set with no recordedByModel beside it, and a refPath
      // populate on those throws. Nothing populates this today; resolve the
      // name through recordedByModel if that ever changes.
      recordedBy: {
        type: mongoose.Schema.Types.ObjectId,
        default: null,
      },

      recordedByModel: {
        type: String,
        enum: ["Receptionist", "Nurse"],
        default: null,
      },
    },

    // A no-show is a distinct outcome from a cancellation - nobody withdrew
    // the booking, the patient simply never arrived - but it frees the slot in
    // exactly the same way. Rather than widen the four-value status enum
    // (which gates completion, the queue and slot release, and would have to
    // be re-reasoned at every one of those), a no-show is recorded as
    // status "Cancelled" PLUS this stamp. `slotActive` then clears through the
    // existing pre-save hook, which is what turns it into a real vacancy.
    //
    // Read it as: cancelledAt says the slot was released, noShowAt says why.
    noShowAt: {
      type: Date,
      default: null,
    },

    // "Ready for doctor" is a nurse hand-off marker, not a queue state. It is
    // a timestamp rather than a new status value because the four-value status
    // enum gates completion, cancellation and the queue itself - widening it
    // would touch every one of those rules to express something none of them
    // need to know about.
    readyForDoctorAt: {
      type: Date,
      default: null,
    },

    // Reception looked at a late arrival and decided to keep them where they
    // are. A timestamp for the same reason as readyForDoctorAt above: it
    // records a DECISION, not a queue state, and nothing about the queue
    // changes when it is set - the patient keeps their slot, their priority
    // and their position, which is exactly what "keep in queue" means.
    //
    // It exists so the decision is not silent. Without it, "keep them" and
    // "have not looked yet" are the same screen, so the row keeps asking a
    // question reception has already answered, and there is no record that
    // anyone answered it.
    //
    // Being late is a fact and stays true; this only says it was considered.
    keptInQueueAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  }
);

// BMI is derived, so recompute it from whatever height/weight the document
// currently holds rather than trusting an incoming value. Runs on validate so
// the stored BMI can never drift from the measurements it came from - including
// when one of them is cleared, which must clear the BMI too.
appointmentSchema.pre("validate", function () {
  if (!this.vitals) return;

  const { heightCm, weightKg } = this.vitals;

  if (!heightCm || !weightKg) {
    this.vitals.bmi = null;
    return;
  }

  const metres = heightCm / 100;
  this.vitals.bmi = Number((weightKg / (metres * metres)).toFixed(1));
});

// Fast search for a doctor's appointments on a particular day
appointmentSchema.index({
  doctorId: 1,
  appointmentDate: 1,
});

// Fast lookup of a patient's full visit history
appointmentSchema.index({ patient: 1, appointmentDate: -1 });

// Auto-generate Booking ID
appointmentSchema.pre("validate", function () {
  if (!this.bookingId) {
    const random = Math.floor(1000 + Math.random() * 9000);
    this.bookingId = `MF-${Date.now()}-${random}`;
  }
});

// Normalize appointmentDate to midnight IST of that calendar day, using
// the same IST-offset pattern as every other date-boundary computation in
// this app (live-queue, check-in, walk-in, dashboard). Deliberately NOT a
// naive .setHours(0,0,0,0), since that operates in the server process's
// local timezone - on a server not running in IST, that would silently
// shift the stored date and disagree with the IST-based range queries
// ($gte/$lte dayStart/dayEnd) used everywhere else. This also resolves an
// existing inconsistency where the online-booking route normalized dates
// with naive local time while the walk-in route already used IST-aware
// math - both now converge on the same correct value.
// A visit can only become Completed with a medical record attached. This
// lived only in the PATCH /appointments/:id handler, so any other write path
// - a script, a bulk update, a future endpoint - could mark a visit finished
// with an empty chart, which is exactly how one appointment ended up
// "Completed" with no diagnosis, no prescription and no completedAt.
// Enforcing it on the model closes every path at once.
//
// Gated on isModified("status") so appointments completed before this rule
// existed are not blocked from unrelated edits; the rule applies from the
// moment a visit is being marked complete.
function assertCompletable(diagnosis, prescription) {
  if (!diagnosis || !String(diagnosis).trim()) {
    throw new Error("Diagnosis is required before completing consultation.");
  }
  if (!prescription || !String(prescription).trim()) {
    throw new Error("Prescription is required before completing consultation.");
  }
}

appointmentSchema.pre("save", function () {
  if (this.isModified("status") && this.status === "Completed") {
    assertCompletable(this.diagnosis, this.prescription);
  }

  if (this.isModified("status") && this.status === "Completed" && !this.completedAt) {
    this.completedAt = new Date();
  }

  // Keep slotActive in step with status so the unique slot index releases a
  // cancelled slot. Set on every save (not just on change) so appointments
  // created before this field existed are corrected the next time they are
  // touched.
  //
  // false, not undefined: assigning undefined to a path that declares
  // `default: true` does not unset it - Mongoose re-applies the default on
  // save, which left cancelled appointments still holding their slot. A
  // partial index filtered on { slotActive: true } excludes false just as
  // it would a missing field.
  this.slotActive = this.status !== "Cancelled";

  if (this.isModified("appointmentDate") && this.appointmentDate) {
    const IST_OFFSET = 5.5 * 60 * 60 * 1000;
    const istShifted = new Date(this.appointmentDate.getTime() + IST_OFFSET);
    const year = istShifted.getUTCFullYear();
    const month = istShifted.getUTCMonth();
    const day = istShifted.getUTCDate();
    this.appointmentDate = new Date(
      Date.UTC(year, month, day, 0, 0, 0, 0) - IST_OFFSET
    );
  }
});

// The same rule for query-style updates. findOneAndUpdate / updateOne /
// updateMany never run the save hook above, so without this a bulk write
// could still mark a visit Completed with an empty chart. Checks the values
// in the update first, falling back to what the document already holds.
appointmentSchema.pre(
  ["findOneAndUpdate", "updateOne", "updateMany"],
  async function () {
    const update = this.getUpdate() || {};
    const next = { ...update, ...(update.$set || {}) };

    if (next.status !== "Completed") return;

    let diagnosis = next.diagnosis;
    let prescription = next.prescription;

    // Only hit the database when the update itself does not settle it.
    if (diagnosis === undefined || prescription === undefined) {
      const existing = await this.model
        .findOne(this.getQuery())
        .select("diagnosis prescription")
        .lean();

      if (diagnosis === undefined) diagnosis = existing?.diagnosis;
      if (prescription === undefined) prescription = existing?.prescription;
    }

    // An explicit $unset of either field alongside Completed is a removal,
    // not a value to fall back on.
    const unset = update.$unset || {};
    if ("diagnosis" in unset) diagnosis = undefined;
    if ("prescription" in unset) prescription = undefined;

    assertCompletable(diagnosis, prescription);
  }
);

// Prevent two appointments from occupying the same doctor/day/slot
// (excluding cancelled appointments, which free up the slot).
//
// This is keyed on `slotActive` rather than `status` because MongoDB rejects
// $ne in a partialFilterExpression ("Expression not supported in partial
// index: $not"). The previous { status: { $ne: "Cancelled" } } therefore
// never applied: the index was created as a PLAIN unique index, so a
// cancelled appointment kept occupying its slot forever. The slot picker
// (which correctly ignores cancelled rows) went on offering that time while
// every attempt to book it failed with "This slot is already booked".
//
// `slotActive` is maintained by the pre-save hook below: true while the
// appointment holds its slot, unset once cancelled. Only equality and a
// handful of other operators are legal in a partial filter, and equality on
// a boolean is.
appointmentSchema.index(
  {
    doctorId: 1,
    appointmentDate: 1,
    slot: 1,
  },
  {
    unique: true,
    partialFilterExpression: { slotActive: true },
  }
);

// Prevent two appointments from ever getting the same token number for the
// same doctor on the same day. This is the DB-level backstop for the
// check-in race condition (two concurrent check-ins reading the same
// "last token" before either write completes).
appointmentSchema.index(
  {
    doctorId: 1,
    appointmentDate: 1,
    tokenNumber: 1,
  },
  {
    unique: true,
    partialFilterExpression: { tokenNumber: { $type: "number" } },
  }
);

// An appointment that came from the waiting list carries a WaitingListEntry
// marked "Assigned". If that appointment is later cancelled - by reception, by
// the patient, or by being marked a no-show - the entry is now claiming an
// assignment that no longer exists, and the patient is neither booked nor on
// the list.
//
// Done here rather than in each cancel path because there are already four of
// them (receptionist cancel, patient cancel, mark no-show, and the stale
// expiry routine) and a fifth would forget. They all end in .save(), so this
// fires for every one.
//
// NOTE: this is a post-save hook, so it does NOT run for updateMany /
// findOneAndUpdate. That is the same caveat that applies to every rule in this
// file - see the completion guard above, which needed a matching query hook
// for exactly that reason. Any future cancel path must use .save().
appointmentSchema.post("save", async function (doc) {
  if (doc.status !== "Cancelled") return;

  try {
    // Required lazily: WaitingListEntry does not require Appointment, but
    // requiring it at the top of this file would still be a needless cycle
    // risk for a rule that only fires on cancellation.
    const WaitingListEntry = require("./WaitingListEntry");

    await WaitingListEntry.updateMany(
      { assignedAppointmentId: doc._id, status: "Assigned" },
      {
        $set: {
          status: "Removed",
          removedAt: new Date(),
        },
      }
    );
  } catch (error) {
    // Never fail the cancellation itself over this - the appointment being
    // cancelled is the important half, and a stale entry is recoverable.
    // Logged rather than swallowed so it is not invisible if it starts
    // happening.
    console.error(
      "Could not release the waiting list entry for a cancelled appointment:",
      error.message
    );
  }
});

module.exports = mongoose.model("Appointment", appointmentSchema);