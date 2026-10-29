import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowLeft,
  FloppyDisk,
  Play,
  CheckCircle,
  DownloadSimple,
  CalendarBlank,
  ArrowsClockwise,
  MagnifyingGlass,
} from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import { getStatusBadgeClass } from "../utils/statusBadge";
import ClinicalRecords from "../components/ClinicalRecords";

const EASE = [0.16, 1, 0.3, 1];

const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const LABEL =
  "block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5";

const FIELD =
  "w-full px-4 py-2.5 text-sm rounded-xl bg-white dark:bg-surface text-slate-900 dark:text-white border border-slate-200 dark:border-surface-border outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed";

// The nurse's observations, in the order they are taken. Every one is
// rendered whether or not it holds a value - see the panel below for why a
// missing measurement is shown rather than hidden.
//
// Each reads a value and returns a formatted string, or null for "not
// recorded". Blood pressure is the reason these are functions rather than a
// field list: it is two stored numbers presented as one reading.
const VITAL_ROWS = [
  { label: "Height", value: (v) => (v?.heightCm ? `${v.heightCm} cm` : null) },
  { label: "Weight", value: (v) => (v?.weightKg ? `${v.weightKg} kg` : null) },
  { label: "BMI", value: (v) => (v?.bmi ? String(v.bmi) : null) },
  {
    label: "Blood Pressure",
    value: (v) =>
      v?.bloodPressureSystolic && v?.bloodPressureDiastolic
        ? `${v.bloodPressureSystolic}/${v.bloodPressureDiastolic} mmHg`
        : null,
  },
  {
    label: "Temperature",
    value: (v) => (v?.temperatureC ? `${v.temperatureC} °C` : null),
  },
  { label: "Pulse", value: (v) => (v?.pulseBpm ? `${v.pulseBpm} bpm` : null) },
  { label: "SpO₂", value: (v) => (v?.spo2 ? `${v.spo2} %` : null) },
  {
    label: "Respiratory Rate",
    value: (v) => (v?.respiratoryRate ? `${v.respiratoryRate}/min` : null),
  },
];

// Whether the nurse recorded anything at all. recordedAt is the authoritative
// signal - the nurse endpoint stamps it on every write and clears it when the
// panel is emptied - but the measurements are checked too, so a legacy row
// written before that stamp existed still renders.
function hasVitals(vitals) {
  if (!vitals) return false;
  if (vitals.recordedAt) return true;
  return VITAL_ROWS.some((row) => row.value(vitals));
}

function fmtRecordedAt(iso) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function Row({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 border-b border-slate-100 dark:border-surface-border last:border-b-0">
      <span className="text-xs text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-sm font-medium text-slate-900 dark:text-white text-right">{children}</span>
    </div>
  );
}

function AppointmentDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const reduceMotion = useReducedMotion();

  const rise = (i = 0) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, ease: EASE, delay: i * 0.05 },
        };

  const [appointment, setAppointment] = useState(null);
  const [loading, setLoading] = useState(true);

  const [form, setForm] = useState({
    diagnosis: "",
    prescription: "",
    notes: "",
  });

  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleSlot, setRescheduleSlot] = useState("");
  const [rescheduleSlots, setRescheduleSlots] = useState([]);

  const isFutureAppointment = appointment
    ? new Date(appointment.appointmentDate).setHours(0, 0, 0, 0) >
      new Date().setHours(0, 0, 0, 0)
    : false;

  useEffect(() => {
    loadAppointment();
  }, []);

  useEffect(() => {
    if (rescheduleDate) {
      loadRescheduleSlots();
    } else {
      setRescheduleSlots([]);
      setRescheduleSlot("");
    }
  }, [rescheduleDate]);

  const loadAppointment = async () => {
    try {
      setLoading(true);
      const res = await API.get(`/appointments/${id}`);

      const appointment = res.data.appointment;

      setAppointment(appointment);

      setForm({
        diagnosis: appointment.diagnosis || "",
        prescription: appointment.prescription || "",
        notes: appointment.notes || "",
      });
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Failed to load appointment"
      );
    } finally {
      setLoading(false);
    }
  };

  const loadRescheduleSlots = async () => {
    try {
      const doctorId = appointment?.doctorId?._id;
      if (!doctorId) return;
      const res = await API.get(`/doctors/${doctorId}/slots?date=${rescheduleDate}`);
      setRescheduleSlots(res.data.slots || []);
      setRescheduleSlot("");
    } catch (err) {
      setRescheduleSlots([]);
    }
  };

  const handleChange = (e) => {
    setForm({
      ...form,
      [e.target.name]: e.target.value,
    });
  };

  const [saving, setSaving] = useState(false);
  const [starting, setStarting] = useState(false);
  const [completing, setCompleting] = useState(false);

  const saveDraft = async () => {
    try {
      setSaving(true);
      await API.patch(`/appointments/${id}`, form);

      toast.success("Medical record saved.");

      loadAppointment();
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Failed to update appointment"
      );
    } finally {
      setSaving(false);
    }
  };

  const startConsultation = async () => {
    try {
      setStarting(true);
      await API.patch(`/doctor/appointments/${id}/start-consultation`);

      toast.success("Consultation started.");

      loadAppointment();
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Failed to start consultation"
      );
    } finally {
      setStarting(false);
    }
  };

  const completeConsultation = async () => {
    // Guard against a second click landing before the first request returns.
    // Without it an impatient double-click fired two identical PATCHes and
    // surfaced two identical error toasts stacked on top of each other.
    if (completing) return;

    // Mirrors the server rule so the doctor is told here rather than after a
    // round trip. The server still enforces it - this is only for speed.
    if (!form.diagnosis?.trim() || !form.prescription?.trim()) {
      toast.warning(
        !form.diagnosis?.trim()
          ? "Enter a diagnosis before completing."
          : "Enter a prescription before completing."
      );
      return;
    }

    try {
      setCompleting(true);
      await API.patch(`/appointments/${id}`, {
        ...form,
        status: "Completed",
      });

      toast.success("Consultation completed.");

      // Back to the dashboard: the visit is finished, and the doctor's next
      // action is the next patient in the queue, not this record.
      navigate("/dashboard");
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Failed to complete consultation"
      );
      setCompleting(false);
    }
  };

  const rescheduleAppointment = async () => {
    if (!rescheduleDate || !rescheduleSlot) {
      toast.warning("Please select date and slot.");
      return;
    }

    try {
      await API.patch(`/appointments/${id}/reschedule`, {
        appointmentDate: rescheduleDate,
        slot: rescheduleSlot,
      });

      toast.success("Appointment rescheduled successfully.");

      loadAppointment();

      setRescheduleDate("");
      setRescheduleSlot("");
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          "Failed to reschedule appointment"
      );
    }
  };

  const downloadPDF = async () => {
    try {
      const response = await API.get(
        `/appointments/${id}/pdf`,
        {
          responseType: "blob",
        }
      );

      const file = new Blob([response.data], {
        type: "application/pdf",
      });

      const url = window.URL.createObjectURL(file);

      const link = document.createElement("a");

      link.href = url;
      link.download = `Prescription-${appointment.bookingId}.pdf`;

      document.body.appendChild(link);

      link.click();

      link.remove();

      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error("Unable to download PDF.");
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-10 w-72 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-80 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1 space-y-6">
              <div className={`h-64 ${CARD} animate-pulse`} />
              <div className={`h-56 ${CARD} animate-pulse`} />
            </div>
            <div className="lg:col-span-2 space-y-6">
              <div className={`h-[420px] ${CARD} animate-pulse`} />
              <div className={`h-56 ${CARD} animate-pulse`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!appointment) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className={`${CARD} p-5 flex flex-col sm:flex-row sm:items-center gap-4`}>
            <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-surface flex items-center justify-center shrink-0">
              <MagnifyingGlass weight="duotone" className="w-5 h-5 text-slate-500" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="font-medium text-slate-900 dark:text-white">Appointment not found</p>
              <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                It may have been removed, or the link is out of date.
              </p>
            </div>
            <button
              onClick={() => navigate("/appointments")}
              className="shrink-0 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150"
            >
              Back to appointments
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        {/* HEADER */}
        <motion.header
          {...rise(0)}
          className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8"
        >
          <div>
            <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em] mb-2">
              Doctor Portal
            </p>
            <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
              Appointment details
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              View and manage this consultation record.
            </p>
          </div>
          <button
            onClick={() => navigate("/appointments")}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full border border-slate-200 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150 shrink-0"
          >
            <ArrowLeft weight="bold" className="w-4 h-4" aria-hidden />
            Back
          </button>
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT - PATIENT + APPOINTMENT */}
          <div className="lg:col-span-1 space-y-6">
            <motion.section {...rise(1)} className={`${CARD} p-6`}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-11 h-11 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
                  <span className="text-white font-bold">
                    {(appointment.patientName || "P").trim().charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">
                    {appointment.patientName}
                  </p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 font-mono truncate">
                    {appointment.phone}
                  </p>
                </div>
              </div>

              <div>
                <Row label="Age">{appointment.age || "Not recorded"}</Row>
                <Row label="Blood group">{appointment.bloodGroup || "Not recorded"}</Row>
              </div>

              {/* Labelled as a group so the panel is addressable as a whole -
                  the heading alone is not, now that it shares a row with the
                  hand-off badge. */}
              <div
                role="group"
                aria-label="Vitals"
                className="mt-4 pt-4 border-t border-slate-200 dark:border-surface-border"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                  {/* Named for who took the measurements, not just for what
                      they are. The doctor is reading someone else's work and
                      the panel should say so before they act on a number. */}
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-300">
                    Nurse Clinical Assessment
                  </p>
                  {/* The nurse's hand-off. Without it the panel may be
                      half-measured or still being taken, which is worth
                      knowing before reading a number off it. */}
                  {appointment.readyForDoctorAt && (
                    <span className="text-[11px] font-semibold text-success-700 dark:text-success-400">
                      Ready for doctor
                    </span>
                  )}
                </div>
                {/* Gated on whether the nurse recorded ANYTHING, not on BMI.
                    BMI only exists once height AND weight are both taken, so
                    keying the whole panel on it hid a complete set of
                    observations - BP, temperature, pulse, SpO2, respiratory
                    rate - from the doctor whenever the nurse had not also
                    reached for the scales. Recording those without height and
                    weight is valid input the server accepts, so it has to be
                    readable here. */}
                {hasVitals(appointment.vitals) ? (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {VITAL_ROWS.map(({ label, value }) => {
                        const reading = value(appointment.vitals);

                        return (
                          <div
                            key={label}
                            className="min-w-0 rounded-xl bg-slate-50 dark:bg-surface px-3 py-2.5 text-center"
                          >
                            <p className="text-[11px] text-slate-500 dark:text-slate-400 break-words">
                              {label}
                            </p>
                            {/* An explicit "Not recorded" rather than a hidden
                                tile: the doctor needs to tell "normal" apart
                                from "nobody measured it", and an absent tile
                                says neither. */}
                            <p
                              className={
                                reading
                                  ? "text-sm font-semibold text-slate-900 dark:text-white break-words"
                                  : "text-sm font-medium text-slate-400 dark:text-slate-500"
                              }
                            >
                              {reading || "Not recorded"}
                            </p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Provenance. Without this the panel sits inside the
                        doctor's own consultation screen and reads as though
                        the doctor entered it. recordedByModel and recordedAt
                        are already stored on every write - nothing new is
                        being tracked here, it was simply never shown. */}
                    <p className="mt-2.5 text-[11px] text-slate-500 dark:text-slate-400 break-words">
                      Recorded by:{" "}
                      <span className="font-semibold">
                        {appointment.vitals?.recordedByModel || "Not recorded"}
                      </span>
                      {appointment.vitals?.recordedAt && (
                        <> · Recorded at: {fmtRecordedAt(appointment.vitals.recordedAt)}</>
                      )}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Not recorded by the nurse yet.
                  </p>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-slate-200 dark:border-surface-border">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-1.5">Symptoms</p>
                <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
                  {appointment.symptoms || "No symptoms recorded"}
                </p>
              </div>
            </motion.section>

            <motion.section {...rise(2)} className={`${CARD} p-6`}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-4">Appointment</h2>
              <Row label="Booking ID">
                <span className="font-mono text-primary-600 dark:text-primary-400">
                  {appointment.bookingId || "N/A"}
                </span>
              </Row>
              <Row label="Date">
                {new Date(appointment.appointmentDate).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </Row>
              <Row label="Time slot">{appointment.slot}</Row>
              <Row label="Status">
                <span className={getStatusBadgeClass(appointment.status)}>{appointment.status}</span>
              </Row>
            </motion.section>
          </div>

          {/* RIGHT - MEDICAL RECORD + RESCHEDULE */}
          <div className="lg:col-span-2 space-y-6">
            <motion.section {...rise(3)} className={`${CARD} p-6`}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                Medical record
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                {isFutureAppointment
                  ? "Editable from the appointment date onwards."
                  : "Diagnosis and prescription are required before completing."}
              </p>

              <div className="space-y-5">
                <div>
                  <label htmlFor="diagnosis" className={LABEL}>
                    Diagnosis
                  </label>
                  <textarea
                    id="diagnosis"
                    rows={3}
                    name="diagnosis"
                    value={form.diagnosis}
                    onChange={handleChange}
                    placeholder={
                      isFutureAppointment
                        ? "Available on the appointment date"
                        : "Enter diagnosis..."
                    }
                    disabled={isFutureAppointment}
                    className={`${FIELD} resize-none`}
                  />
                </div>

                <div>
                  <label htmlFor="prescription" className={LABEL}>
                    Prescription
                  </label>
                  <textarea
                    id="prescription"
                    rows={3}
                    name="prescription"
                    value={form.prescription}
                    onChange={handleChange}
                    placeholder={
                      isFutureAppointment
                        ? "Available on the appointment date"
                        : "Enter prescription..."
                    }
                    disabled={isFutureAppointment}
                    className={`${FIELD} resize-none`}
                  />
                </div>

                <div>
                  <label htmlFor="notes" className={LABEL}>
                    Notes
                  </label>
                  <textarea
                    id="notes"
                    rows={3}
                    name="notes"
                    value={form.notes}
                    onChange={handleChange}
                    placeholder={
                      isFutureAppointment
                        ? "Available on the appointment date"
                        : "Additional notes..."
                    }
                    disabled={isFutureAppointment}
                    className={`${FIELD} resize-none`}
                  />
                </div>

                <div className="flex flex-col sm:flex-row flex-wrap gap-2.5 pt-1">
                  <button
                    onClick={saveDraft}
                    disabled={isFutureAppointment || saving}
                    className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-slate-200 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <FloppyDisk weight="duotone" className="w-4 h-4" aria-hidden />
                    {isFutureAppointment
                      ? "Available on appointment date"
                      : saving
                        ? "Saving…"
                        : "Save draft"}
                  </button>

                  {appointment.status === "Waiting" && (
                    <button
                      onClick={startConsultation}
                      disabled={isFutureAppointment || starting}
                      className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Play weight="fill" className="w-4 h-4" aria-hidden />
                      {starting ? "Starting…" : "Start consultation"}
                    </button>
                  )}

                  {appointment.status === "In Consultation" && (
                    <button
                      onClick={completeConsultation}
                      disabled={
                        isFutureAppointment ||
                        completing ||
                        !form.diagnosis.trim() ||
                        !form.prescription.trim()
                      }
                      title={
                        !form.diagnosis.trim() || !form.prescription.trim()
                          ? "Diagnosis and prescription are required before completing"
                          : undefined
                      }
                      className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <CheckCircle weight="duotone" className="w-4 h-4" aria-hidden />
                      {completing ? "Completing…" : "Complete consultation"}
                    </button>
                  )}

                  {appointment.status === "Completed" && (
                    <span className="inline-flex items-center justify-center badge-completed">
                      Consultation completed
                    </span>
                  )}

                  <button
                    onClick={downloadPDF}
                    disabled={isFutureAppointment}
                    className="inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-slate-200 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <DownloadSimple weight="duotone" className="w-4 h-4" aria-hidden />
                    {isFutureAppointment ? "Available on appointment date" : "Download PDF"}
                  </button>
                </div>
              </div>
            </motion.section>

            <motion.div {...rise(4)}>
              <ClinicalRecords
                appointmentId={id}
                readOnly={isFutureAppointment}
              />
            </motion.div>

            <motion.section {...rise(5)} className={`${CARD} p-6`}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-warning-50 text-warning-600 dark:bg-warning-500/10 flex items-center justify-center shrink-0">
                  <CalendarBlank weight="duotone" className="w-5 h-5" aria-hidden />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Reschedule appointment
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Pick a date to see the slots still open.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="rescheduleDate" className={LABEL}>
                    New date
                  </label>
                  <input
                    id="rescheduleDate"
                    type="date"
                    value={rescheduleDate}
                    onChange={(e) => setRescheduleDate(e.target.value)}
                    className={FIELD}
                  />
                </div>

                <div>
                  <label htmlFor="rescheduleSlot" className={LABEL}>
                    New time slot
                  </label>
                  {rescheduleDate ? (
                    <select
                      id="rescheduleSlot"
                      value={rescheduleSlot}
                      onChange={(e) => setRescheduleSlot(e.target.value)}
                      className={FIELD}
                    >
                      <option value="">
                        {rescheduleSlots.length === 0 ? "No slots available" : "Choose a slot"}
                      </option>
                      {rescheduleSlots.map((slot) => (
                        <option key={slot} value={slot}>{slot}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      id="rescheduleSlot"
                      type="text"
                      placeholder="Select a date first"
                      value={rescheduleSlot}
                      onChange={(e) => setRescheduleSlot(e.target.value)}
                      className={FIELD}
                      disabled
                    />
                  )}
                </div>
              </div>

              <button
                onClick={rescheduleAppointment}
                disabled={!rescheduleDate || !rescheduleSlot}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-warning-600 text-white text-sm font-semibold hover:bg-warning-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <ArrowsClockwise weight="bold" className="w-4 h-4" aria-hidden />
                Reschedule appointment
              </button>
            </motion.section>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AppointmentDetails;
