import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  MapPin,
  Clock,
  CurrencyInr,
  FloppyDisk,
  Prohibit,
  LockKeyOpen,
  CheckCircle,
  XCircle,
} from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import ConfirmModal from "../components/ConfirmModal";
import useFirstMountThisSession from "../hooks/useFirstMountThisSession";

const EASE = [0.16, 1, 0.3, 1];

const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const LABEL = "block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5";

const FIELD =
  "w-full px-4 py-2.5 text-sm rounded-xl bg-white dark:bg-surface text-slate-900 dark:text-white border border-slate-200 dark:border-surface-border outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition duration-150";

function DoctorProfile() {
  const navigate = useNavigate();
  const toast = useToast();
  const shouldAnimate = useFirstMountThisSession("doctor-profile-page");
  const reduceMotion = useReducedMotion();
  const animate = shouldAnimate && !reduceMotion;

  const rise = (i = 0) =>
    animate
      ? {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, ease: EASE, delay: i * 0.05 },
        }
      : {};

  const [doctor, setDoctor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [confirmModal, setConfirmModal] = useState(null);

  const [form, setForm] = useState({
    name: "",
    specialization: "",
    location: "",
    experience: "",
    consultationFee: "",
    startTime: "",
    endTime: "",
    slotDuration: "",
  });

  // Block slot state
  const [blockDate, setBlockDate] = useState("");
  const [blockSlot, setBlockSlot] = useState("");
  const [blockReason, setBlockReason] = useState("");
  const [isFullDay, setIsFullDay] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);
  const [blockSlots, setBlockSlots] = useState([]);

  // Unblock slot state
  const [unblockDate, setUnblockDate] = useState("");
  const [unblockSlot, setUnblockSlot] = useState("");
  const [unblockFullDay, setUnblockFullDay] = useState(false);
  const [unblockLoading, setUnblockLoading] = useState(false);
  const [unblockSlots, setUnblockSlots] = useState([]);

  useEffect(() => {
    loadDoctor();
  }, []);

  useEffect(() => {
    if (blockDate && !isFullDay) {
      loadSlotsForBlock();
    } else {
      setBlockSlots([]);
      setBlockSlot("");
    }
  }, [blockDate, isFullDay]);

  useEffect(() => {
    if (unblockDate && !unblockFullDay) {
      loadSlotsForUnblock();
    } else {
      setUnblockSlots([]);
      setUnblockSlot("");
    }
  }, [unblockDate, unblockFullDay]);

  const loadDoctor = async () => {
    try {
      setLoading(true);
      const stored = JSON.parse(localStorage.getItem("doctor"));
      if (!stored?._id) {
        toast.warning("Please login again.");
        navigate("/doctor-login");
        return;
      }
      const res = await API.get(`/doctors/${stored._id}`);
      const currentDoctor = res.data.doctor;
      setDoctor(currentDoctor);
      setForm({
        name: currentDoctor.name || "",
        specialization: currentDoctor.specialization || "",
        location: currentDoctor.location || "",
        experience: currentDoctor.experience || "",
        consultationFee: currentDoctor.consultationFee || "",
        startTime: currentDoctor.workingHours?.start || "",
        endTime: currentDoctor.workingHours?.end || "",
        slotDuration: currentDoctor.slotDuration || "",
      });
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load profile");
    } finally {
      setLoading(false);
    }
  };

  const loadSlotsForBlock = async () => {
    try {
      const stored = JSON.parse(localStorage.getItem("doctor"));
      const res = await API.get(`/doctors/${stored._id}/slots?date=${blockDate}`);
      setBlockSlots(res.data.slots || []);
      setBlockSlot("");
    } catch (err) {
      setBlockSlots([]);
    }
  };

  const loadSlotsForUnblock = async () => {
    try {
      const stored = JSON.parse(localStorage.getItem("doctor"));
      const res = await API.get(`/doctors/${stored._id}/slots?date=${unblockDate}`);
      setUnblockSlots(res.data.slots || []);
      setUnblockSlot("");
    } catch (err) {
      setUnblockSlots([]);
    }
  };

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const saveProfile = async () => {
    try {
      setSaving(true);
      await API.patch("/doctor/profile", {
        ...form,
        experience: Number(form.experience),
        consultationFee: Number(form.consultationFee),
        slotDuration: Number(form.slotDuration),
      });
      toast.success("Profile updated successfully");
      loadDoctor();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update profile");
    } finally {
      setSaving(false);
    }
  };

  const toggleAvailability = async () => {
    try {
      setAvailabilityLoading(true);
      await API.patch("/doctor/availability", {
        isAvailable: !doctor.isAvailable,
      });
      loadDoctor();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update availability");
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const blockSlotHandler = async () => {
    if (!blockDate) {
      toast.warning("Please select a date.");
      return;
    }
    if (!isFullDay && !blockSlot) {
      toast.warning("Please select a slot.");
      return;
    }
    setConfirmModal({
      title: isFullDay ? "Block Full Day Leave" : "Block Slot",
      message: isFullDay ? "Block the entire day?" : `Block slot ${blockSlot}?`,
      variant: "danger",
      confirmLabel: "Block",
      onConfirm: async () => {
        try {
          setBlockLoading(true);
          await API.patch(`/doctors/${doctor._id}/block-slot`, {
            date: blockDate,
            slot: isFullDay ? undefined : blockSlot,
            isFullDay,
            reason: blockReason,
          });
          toast.success(isFullDay ? "Full day blocked successfully." : "Slot blocked successfully.");
          setBlockDate("");
          setBlockSlot("");
          setBlockReason("");
          setIsFullDay(false);
          setBlockSlots([]);
          loadDoctor();
        } catch (err) {
          toast.error(err.response?.data?.message || "Failed to block slot");
        } finally {
          setBlockLoading(false);
        }
      },
    });
  };

  const unblockSlotHandler = async () => {
    if (!unblockDate) {
      toast.warning("Please select a date.");
      return;
    }
    if (!unblockFullDay && !unblockSlot) {
      toast.warning("Please select a slot.");
      return;
    }
    setConfirmModal({
      title: unblockFullDay ? "Remove Full Day Leave" : "Unblock Slot",
      message: unblockFullDay ? "Remove full day leave?" : `Unblock slot ${unblockSlot}?`,
      variant: "info",
      confirmLabel: "Unblock",
      onConfirm: async () => {
        try {
          setUnblockLoading(true);
          await API.patch(`/doctors/${doctor._id}/unblock-slot`, {
            date: unblockDate,
            slot: unblockFullDay ? undefined : unblockSlot,
            isFullDay: unblockFullDay,
          });
          toast.success(unblockFullDay ? "Full day leave removed." : "Slot unblocked successfully.");
          setUnblockDate("");
          setUnblockSlot("");
          setUnblockFullDay(false);
          setUnblockSlots([]);
          loadDoctor();
        } catch (err) {
          toast.error(err.response?.data?.message || "Failed to unblock slot");
        } finally {
          setUnblockLoading(false);
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-5xl mx-auto">
          <div className="h-10 w-64 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-80 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className={`lg:col-span-1 h-80 ${CARD} animate-pulse`} />
            <div className="lg:col-span-2 space-y-6">
              <div className={`h-72 ${CARD} animate-pulse`} />
              <div className={`h-56 ${CARD} animate-pulse`} />
              <div className={`h-72 ${CARD} animate-pulse`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // The Doctor model has no photo field, so the avatar is always initials.
  const initials = (form.name || "D")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w.charAt(0).toUpperCase())
    .join("");

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
              Doctor profile
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              Manage your profile, working hours and leave.
            </p>
          </div>
          <button
            onClick={saveProfile}
            disabled={saving}
            className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none shrink-0"
          >
            <FloppyDisk weight="duotone" className="w-4 h-4" aria-hidden />
            {saving ? "Saving…" : "Save changes"}
          </button>
        </motion.header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* LEFT - IDENTITY */}
          <motion.aside {...rise(1)} className={`lg:col-span-1 ${CARD} p-6 h-fit`}>
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
                <span className="text-white text-xl font-bold">{initials}</span>
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white truncate">
                  {form.name}
                </h2>
                <span className="inline-flex items-center px-2.5 py-0.5 mt-1 rounded-full text-xs font-semibold bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300">
                  {form.specialization}
                </span>
              </div>
            </div>

            {/* AVAILABILITY */}
            <div className="mt-6 rounded-2xl border border-slate-200 dark:border-surface-border p-4">
              <div className="flex items-center justify-between gap-3 mb-3">
                <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  Availability
                </span>
                <span
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                    doctor.isAvailable
                      ? "text-success-600 dark:text-success-400"
                      : "text-danger-600 dark:text-danger-400"
                  }`}
                >
                  {doctor.isAvailable ? (
                    <CheckCircle weight="duotone" className="w-4 h-4" aria-hidden />
                  ) : (
                    <XCircle weight="duotone" className="w-4 h-4" aria-hidden />
                  )}
                  {doctor.isAvailable ? "Available" : "Unavailable"}
                </span>
              </div>
              <button
                onClick={toggleAvailability}
                disabled={availabilityLoading}
                className={`w-full h-11 px-5 rounded-full text-sm font-semibold text-white active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none ${
                  doctor.isAvailable
                    ? "bg-danger-500 hover:bg-danger-600"
                    : "bg-success-500 hover:bg-success-600"
                }`}
              >
                {availabilityLoading
                  ? "Updating…"
                  : doctor.isAvailable
                    ? "Mark unavailable"
                    : "Mark available"}
              </button>
            </div>

            {/* QUICK FACTS */}
            <dl className="mt-6 space-y-3">
              {[
                { label: "Location", value: form.location, Icon: MapPin, tone: "bg-primary-50 text-primary-600 dark:bg-primary-500/10" },
                { label: "Experience", value: form.experience ? `${form.experience} years` : "", Icon: Clock, tone: "bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10" },
                { label: "Fee", value: form.consultationFee ? `₹${form.consultationFee} / visit` : "", Icon: CurrencyInr, tone: "bg-success-50 text-success-600 dark:bg-success-500/10" },
              ].map(({ label, value, Icon, tone }) => (
                <div key={label} className="flex items-center gap-3">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
                    <Icon weight="duotone" className="w-5 h-5" aria-hidden />
                  </div>
                  <dt className="text-sm text-slate-500 dark:text-slate-400 flex-1">{label}</dt>
                  <dd
                    className={`text-sm font-semibold text-right ${
                      value ? "text-slate-900 dark:text-white" : "text-slate-500 dark:text-slate-400"
                    }`}
                  >
                    {value || "Not set"}
                  </dd>
                </div>
              ))}
            </dl>
          </motion.aside>

          {/* RIGHT - FORMS */}
          <div className="lg:col-span-2 space-y-6">
            <motion.section {...rise(2)} className={`${CARD} p-6`}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">
                Personal information
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="name" className={LABEL}>
                    Full name
                  </label>
                  <input
                    id="name"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    className={FIELD}
                  />
                </div>

                <div>
                  <label htmlFor="specialization" className={LABEL}>
                    Specialization
                  </label>
                  <input
                    id="specialization"
                    type="text"
                    name="specialization"
                    value={form.specialization}
                    onChange={handleChange}
                    className={FIELD}
                  />
                </div>

                <div>
                  <label htmlFor="location" className={LABEL}>
                    Location
                  </label>
                  <input
                    id="location"
                    type="text"
                    name="location"
                    value={form.location}
                    onChange={handleChange}
                    className={FIELD}
                  />
                </div>

                <div>
                  <label htmlFor="experience" className={LABEL}>
                    Experience (years)
                  </label>
                  <input
                    id="experience"
                    type="number"
                    name="experience"
                    value={form.experience}
                    onChange={handleChange}
                    className={FIELD}
                  />
                </div>

                <div className="sm:col-span-2">
                  <label htmlFor="consultationFee" className={LABEL}>
                    Consultation fee (₹)
                  </label>
                  <input
                    id="consultationFee"
                    type="number"
                    name="consultationFee"
                    value={form.consultationFee}
                    onChange={handleChange}
                    className={FIELD}
                  />
                </div>
              </div>
            </motion.section>

            <motion.section {...rise(3)} className={`${CARD} p-6`}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-1">
                Working hours
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-5">
                Slots are generated between these times.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label htmlFor="startTime" className={LABEL}>
                    Start time
                  </label>
                  <input
                    id="startTime"
                    type="time"
                    name="startTime"
                    value={form.startTime}
                    onChange={handleChange}
                    className={FIELD}
                  />
                </div>

                <div>
                  <label htmlFor="endTime" className={LABEL}>
                    End time
                  </label>
                  <input
                    id="endTime"
                    type="time"
                    name="endTime"
                    value={form.endTime}
                    onChange={handleChange}
                    className={FIELD}
                  />
                </div>

                <div>
                  <label htmlFor="slotDuration" className={LABEL}>
                    Slot duration (min)
                  </label>
                  <input
                    id="slotDuration"
                    type="number"
                    name="slotDuration"
                    value={form.slotDuration}
                    onChange={handleChange}
                    className={FIELD}
                  />
                </div>
              </div>

              <div className="mt-6 flex justify-end">
                <button
                  onClick={saveProfile}
                  disabled={saving}
                  className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
                >
                  <FloppyDisk weight="duotone" className="w-4 h-4" aria-hidden />
                  {saving ? "Saving…" : "Save changes"}
                </button>
              </div>
            </motion.section>

            {/* BLOCK SLOT */}
            <motion.section {...rise(4)} className={`${CARD} p-6`}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-danger-50 text-danger-600 dark:bg-danger-500/10 flex items-center justify-center shrink-0">
                  <Prohibit weight="duotone" className="w-5 h-5" aria-hidden />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Block slot / leave
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Stop new bookings for a slot or a whole day.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="blockDate" className={LABEL}>
                    Date
                  </label>
                  <input
                    id="blockDate"
                    type="date"
                    value={blockDate}
                    onChange={(e) => setBlockDate(e.target.value)}
                    className={FIELD}
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2.5 cursor-pointer h-11">
                    <input
                      type="checkbox"
                      checked={isFullDay}
                      onChange={(e) => setIsFullDay(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Full day leave
                    </span>
                  </label>
                </div>
              </div>

              {!isFullDay && (
                <div className="mb-4">
                  <label className={LABEL}>Select slot</label>
                  <select
                    value={blockSlot}
                    onChange={(e) => setBlockSlot(e.target.value)}
                    className={FIELD}
                  >
                    <option value="">
                      {blockDate ? (blockSlots.length === 0 ? "No slots available" : "Choose Slot") : "Select a date first"}
                    </option>
                    {blockSlots.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}

              <div className="mb-5">
                <label htmlFor="blockReason" className={LABEL}>
                  Reason (optional)
                </label>
                <input
                  id="blockReason"
                  type="text"
                  placeholder="Reason for blocking"
                  value={blockReason}
                  onChange={(e) => setBlockReason(e.target.value)}
                  className={FIELD}
                />
              </div>

              <button
                onClick={blockSlotHandler}
                disabled={blockLoading}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-danger-500 text-white text-sm font-semibold hover:bg-danger-600 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
              >
                <Prohibit weight="bold" className="w-4 h-4" aria-hidden />
                {blockLoading ? "Blocking…" : "Block slot"}
              </button>
            </motion.section>

            {/* UNBLOCK SLOT */}
            <motion.section {...rise(5)} className={`${CARD} p-6`}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl bg-success-50 text-success-600 dark:bg-success-500/10 flex items-center justify-center shrink-0">
                  <LockKeyOpen weight="duotone" className="w-5 h-5" aria-hidden />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    Unblock slot / remove leave
                  </h2>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Reopen a slot or a full day for bookings.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label htmlFor="unblockDate" className={LABEL}>
                    Date
                  </label>
                  <input
                    id="unblockDate"
                    type="date"
                    value={unblockDate}
                    onChange={(e) => setUnblockDate(e.target.value)}
                    className={FIELD}
                  />
                </div>

                <div className="flex items-end">
                  <label className="flex items-center gap-2.5 cursor-pointer h-11">
                    <input
                      type="checkbox"
                      checked={unblockFullDay}
                      onChange={(e) => setUnblockFullDay(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                    />
                    <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                      Full day leave
                    </span>
                  </label>
                </div>
              </div>

              {!unblockFullDay && (
                <div className="mb-5">
                  <label className={LABEL}>Select slot</label>
                  <select
                    value={unblockSlot}
                    onChange={(e) => setUnblockSlot(e.target.value)}
                    className={FIELD}
                  >
                    <option value="">
                      {unblockDate ? (unblockSlots.length === 0 ? "No slots available" : "Choose Slot") : "Select a date first"}
                    </option>
                    {unblockSlots.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              )}

              <button
                onClick={unblockSlotHandler}
                disabled={unblockLoading}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-success-500 text-white text-sm font-semibold hover:bg-success-600 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
              >
                <LockKeyOpen weight="bold" className="w-4 h-4" aria-hidden />
                {unblockLoading ? "Unblocking…" : "Unblock slot"}
              </button>
            </motion.section>
          </div>
        </div>
      </div>
      <ConfirmModal
        config={confirmModal}
        onClose={() => setConfirmModal(null)}
      />
    </div>
  );
}

export default DoctorProfile;
