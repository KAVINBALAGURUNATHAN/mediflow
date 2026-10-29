const mongoose = require("mongoose");
const { normalizeToIstDay } = require("../utils/istDay");

const blockedSlotSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Doctor",
      required: true,
      index: true,
    },

    // Date for which the slot is blocked
    date: {
      type: Date,
      required: true,
      index: true,
    },

    // Null when the entire day is blocked
    slot: {
      type: String,
      default: null,
      trim: true,
      validate: [
        {
          // `this` here correctly refers to the document being validated,
          // so branch the message from inside the validator itself rather
          // than in a separate `message` function (whose `this` is NOT
          // bound to the document and would always report the wrong
          // branch, verified: it produced "slot is required when
          // isFullDay is false" even for isFullDay === true).
          validator: function (value) {
            if (this.isFullDay) {
              if (value !== null) {
                throw new Error("slot must be null when isFullDay is true");
              }
              return true;
            }

            if (value === null || value === "") {
              throw new Error("slot is required when isFullDay is false");
            }

            return true;
          },
        },
        {
          // Enforces the actual slot format used across the app
          // (e.g. "09:00 AM", "01:30 PM" — matches how generateSlots()
          // produces slots and how slotToMinutes()/toMinutes() parse
          // them via `slot.split(" ")`). Only applies when a slot value
          // is present, so full-day blocks (slot: null) are unaffected.
          validator: function (value) {
            if (value === null || value === "") return true;
            return /^(0?[1-9]|1[0-2]):[0-5]\d (AM|PM)$/i.test(value);
          },
          message: "Slot must be in 'hh:mm AM/PM' format (e.g. '09:00 AM')",
        },
      ],
    },

    // True if the doctor is unavailable for the whole day
    isFullDay: {
      type: Boolean,
      default: false,
    },

    // Part of a RECOVERY WINDOW: a period at the end of a session held for
    // patients still on the waiting list.
    //
    //   8 AM - 12 PM   normal appointments
    //   12 PM - 1 PM   recovery window
    //
    // Stored as a BlockedSlot because "not offered by the booking path" is
    // exactly what a block already means, so getDoctorDaySlots hides it from
    // patients with no change at all. The difference from an ordinary block is
    // who may still use it: reception can assign a recovery slot to a waiting
    // patient, which is the whole point of holding it.
    //
    // The window is a RUN of these - one per slot in the range - so its size
    // follows the doctor's actual schedule rather than a fixed number of
    // appointments.
    isRecovery: {
      type: Boolean,
      default: false,
    },

    // Optional reason (Vacation, Holiday, Conference, etc.)
    reason: {
      type: String,
      trim: true,
      default: "",
      maxlength: 200,
    },
  },
  {
    timestamps: true,
  }
);

// Prevent duplicate blocked slots
blockedSlotSchema.index(
  {
    doctorId: 1,
    date: 1,
    slot: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isFullDay: false,
    },
  }
);

// Prevent duplicate full-day blocks
blockedSlotSchema.index(
  {
    doctorId: 1,
    date: 1,
    isFullDay: 1,
  },
  {
    unique: true,
    partialFilterExpression: {
      isFullDay: true,
    },
  }
);

// Normalize `date` to IST midnight before every save, regardless of what
// time-of-day was passed in. This is a model-layer safety net: even though
// the block-slot route in server.js normalizes the date before constructing
// the document, this guarantees the invariant holds for ANY future or
// alternate call site that forgets to - the schema, not the caller, is what
// owns "a block always represents a full calendar day, never an instant."
//
// This must match how Appointment.appointmentDate is normalized (IST midnight
// expressed in UTC), because both are read back through the same
// getISTDayRange() day windows. It previously used setHours, which resolves
// in the server process's timezone: identical to IST normalization on an IST
// machine, a different instant entirely on a UTC host like Render, where it
// left blocked slots outside the day window that was meant to find them.
blockedSlotSchema.pre("save", function () {
  const normalized = normalizeToIstDay(this.date);
  if (normalized) {
    this.date = normalized;
  }
});

module.exports = mongoose.model("BlockedSlot", blockedSlotSchema);