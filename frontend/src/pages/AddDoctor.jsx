import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  Eye,
  EyeSlash,
  CircleNotch,
  UserPlus,
  Warning,
} from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import useFirstMountThisSession from "../hooks/useFirstMountThisSession";
import useMasterLists from "../hooks/useMasterLists";
import MasterListSelect from "../components/MasterListSelect";

const EASE = [0.16, 1, 0.3, 1];

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

/* ── shared input treatment ───────────────────────────────────── */
const INPUT_BASE =
  "w-full h-11 px-3.5 rounded-lg text-sm bg-white dark:bg-surface text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 border outline-none transition duration-150";
const INPUT_OK =
  "border-slate-300 dark:border-surface-border focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10";
const INPUT_ERR =
  "border-danger-500 dark:border-danger-500 focus:border-danger-500 focus:ring-4 focus:ring-danger-500/10";

/* ── shared field wrapper ─────────────────────────────────────── */
function Field({ label, hint, required, htmlFor, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
      >
        {label}
        {required && <span className="text-danger-600 ml-0.5">*</span>}
        {hint && (
          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">
            {hint}
          </span>
        )}
      </label>
      {children}
    </div>
  );
}

/* ── inline field error, never an alert() ── */
function FieldError({ children }) {
  if (!children) return null;
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-danger-600 dark:text-danger-400">
      <Warning weight="duotone" className="w-4 h-4 shrink-0" aria-hidden />
      {children}
    </p>
  );
}

/* ── section divider - flat uppercase eyebrow, matches the FormSection
   convention used in AdminDashboard (EditDoctorPanel, receptionist form)
   so this form reads as part of the same system rather than its own
   wizard-style component. ── */
function Section({ title, description }) {
  return (
    <div className="space-y-1 pb-3 mb-5 border-b border-slate-100 dark:border-surface-border">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400">
        {title}
      </h3>
      {description && (
        <p className="text-[13px] text-slate-500 dark:text-slate-400">{description}</p>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════ */
function AddDoctor({ isEmbedded, onSuccess }) {
  const navigate = useNavigate();
  const toast = useToast();
  const shouldAnimate = useFirstMountThisSession("add-doctor-page");
  const reduceMotion = useReducedMotion();
  const { specializations, hospitals, reloadLists } = useMasterLists();

  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    specializationId: "",
    experience: "",
    consultationFee: "",
    hospitalId: "",
    workingHoursStart: "09:00",
    workingHoursEnd: "17:00",
    slotDuration: "20",
    isAvailable: true,
    qualification: "",
    workingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  });

  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});

  const handleChange = (e) => {
    const value = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((prev) => ({ ...prev, [e.target.name]: value }));
    if (errors[e.target.name]) {
      setErrors((prev) => ({ ...prev, [e.target.name]: "" }));
    }
  };

  const toggleWorkingDay = (day) => {
    setForm((prev) => ({
      ...prev,
      workingDays: prev.workingDays.includes(day)
        ? prev.workingDays.filter((d) => d !== day)
        : [...prev.workingDays, day],
    }));
  };

  const validate = () => {
    const errs = {};
    if (!form.name.trim()) errs.name = "Name is required.";
    if (!form.email.trim()) errs.email = "Email is required.";
    if (!form.password || form.password.length < 6) errs.password = "Password must be at least 6 characters.";
    if (!form.specializationId) errs.specializationId = "Specialization is required.";
    if (!form.experience || Number(form.experience) < 0) errs.experience = "Enter valid experience.";
    if (!form.consultationFee || Number(form.consultationFee) < 0) errs.consultationFee = "Enter valid fee.";
    if (!form.hospitalId) errs.hospitalId = "Hospital is required.";
    return errs;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast.warning("Please fix the highlighted fields before submitting.");
      return;
    }
    try {
      setLoading(true);
      await API.post("/admin/doctors", {
        ...form,
        experience: Number(form.experience),
        consultationFee: Number(form.consultationFee),
        slotDuration: Number(form.slotDuration),
      });
      toast.success("Doctor account created successfully.", {
        title: "Account Created",
      });
      if (onSuccess) {
        onSuccess();
      } else {
        navigate("/admin-dashboard");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create doctor account.");
    } finally {
      setLoading(false);
    }
  };

  const inputCls = (field) => `${INPUT_BASE} ${errors[field] ? INPUT_ERR : INPUT_OK}`;

  const wrapper = isEmbedded
    ? "space-y-6"
    : "min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12";

  // Animation is gated twice: once on the per-session first mount (so tab
  // switches inside the admin shell don't replay it) and once on the user's
  // reduced-motion preference.
  const animate = shouldAnimate && !reduceMotion;
  const rise = (delay = 0) => ({
    initial: animate ? { opacity: 0, y: 12 } : false,
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: EASE, delay: animate ? delay : 0 },
  });

  return (
    <div className={wrapper}>
      <div className={isEmbedded ? "" : "max-w-3xl mx-auto"}>
        {!isEmbedded && (
          <motion.header {...rise(0)} className="mb-8">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary-600 dark:text-primary-400 mb-2">
              Admin · Staff Onboarding
            </p>
            <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
              Add Doctor Account
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              Register a new doctor with their credentials, specialization, and schedule.
            </p>
          </motion.header>
        )}

        <form onSubmit={handleSubmit} noValidate>
          <motion.div
            {...rise(0.05)}
            className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-6 space-y-8"
          >
            {/* ── Section 1: Account ── */}
            <div>
              <Section
                title="Account Information"
                description="Login credentials for the doctor portal."
              />
              <div className="space-y-4">
                <Field label="Full Name" required htmlFor="doctor-name">
                  <input
                    id="doctor-name"
                    type="text"
                    name="name"
                    value={form.name}
                    onChange={handleChange}
                    placeholder="Dr. Anjali Mehta"
                    className={inputCls("name")}
                  />
                  <FieldError>{errors.name}</FieldError>
                </Field>

                <Field label="Email Address" required htmlFor="doctor-email">
                  <input
                    id="doctor-email"
                    type="email"
                    name="email"
                    value={form.email}
                    onChange={handleChange}
                    placeholder="doctor@hospital.com"
                    className={inputCls("email")}
                  />
                  <FieldError>{errors.email}</FieldError>
                </Field>

                <Field label="Password" required hint="min. 6 characters" htmlFor="doctor-password">
                  <div className="relative">
                    <input
                      id="doctor-password"
                      type={showPassword ? "text" : "password"}
                      name="password"
                      value={form.password}
                      onChange={handleChange}
                      placeholder="••••••••"
                      className={`${inputCls("password")} pr-11`}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-white/5 transition duration-150"
                      aria-label={showPassword ? "Hide password" : "Show password"}
                    >
                      {showPassword ? (
                        <EyeSlash weight="duotone" className="w-[18px] h-[18px]" aria-hidden />
                      ) : (
                        <Eye weight="duotone" className="w-[18px] h-[18px]" aria-hidden />
                      )}
                    </button>
                  </div>
                  <FieldError>{errors.password}</FieldError>
                </Field>
              </div>
            </div>

            {/* ── Section 2: Professional ── */}
            <div>
              <Section
                title="Professional Information"
                description="Specialization and consultation details shown to patients."
              />
              <div className="space-y-4">
                <MasterListSelect
                  label="Specialization"
                  required
                  options={specializations}
                  value={form.specializationId}
                  onChange={(id) => {
                    setForm((prev) => ({ ...prev, specializationId: id }));
                    if (errors.specializationId) setErrors((prev) => ({ ...prev, specializationId: "" }));
                  }}
                  createEndpoint="/admin/specializations"
                  responseKey="specialization"
                  onCreated={reloadLists}
                  error={errors.specializationId}
                  placeholder="Select specialization…"
                  addLabel="Add specialization"
                  namePlaceholder="e.g. Cardiology"
                />

                <Field
                  label="Qualification"
                  hint="shown on the doctor's public profile"
                  htmlFor="doctor-qualification"
                >
                  <input
                    id="doctor-qualification"
                    type="text"
                    name="qualification"
                    value={form.qualification}
                    onChange={handleChange}
                    placeholder="e.g. MBBS, MD"
                    className={inputCls("qualification")}
                  />
                </Field>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Experience" required hint="years" htmlFor="doctor-experience">
                    <input
                      id="doctor-experience"
                      type="number"
                      name="experience"
                      value={form.experience}
                      onChange={handleChange}
                      placeholder="0"
                      min="0"
                      className={`${inputCls("experience")} tabular-nums`}
                    />
                    <FieldError>{errors.experience}</FieldError>
                  </Field>
                  <Field label="Consultation Fee" required hint="₹ per visit" htmlFor="doctor-fee">
                    <input
                      id="doctor-fee"
                      type="number"
                      name="consultationFee"
                      value={form.consultationFee}
                      onChange={handleChange}
                      placeholder="500"
                      min="0"
                      className={`${inputCls("consultationFee")} tabular-nums`}
                    />
                    <FieldError>{errors.consultationFee}</FieldError>
                  </Field>
                </div>
              </div>
            </div>

            {/* ── Section 3: Clinic ── */}
            <div>
              <Section
                title="Clinic Information"
                description="Location of the doctor's practice."
              />
              <MasterListSelect
                label="Clinic / Hospital"
                required
                options={hospitals}
                value={form.hospitalId}
                onChange={(id) => {
                  setForm((prev) => ({ ...prev, hospitalId: id }));
                  if (errors.hospitalId) setErrors((prev) => ({ ...prev, hospitalId: "" }));
                }}
                createEndpoint="/admin/hospitals"
                responseKey="hospital"
                onCreated={reloadLists}
                error={errors.hospitalId}
                placeholder="Select hospital…"
                addLabel="Add hospital"
                namePlaceholder="e.g. Apollo Hospital, Mumbai"
              />
            </div>

            {/* ── Section 4: Schedule ── */}
            <div>
              <Section
                title="Schedule & Availability"
                description="Working hours and appointment slot configuration."
              />
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Working Hours Start" htmlFor="doctor-start">
                    <input
                      id="doctor-start"
                      type="time"
                      name="workingHoursStart"
                      value={form.workingHoursStart}
                      onChange={handleChange}
                      className={`${INPUT_BASE} ${INPUT_OK} tabular-nums`}
                    />
                  </Field>
                  <Field label="Working Hours End" htmlFor="doctor-end">
                    <input
                      id="doctor-end"
                      type="time"
                      name="workingHoursEnd"
                      value={form.workingHoursEnd}
                      onChange={handleChange}
                      className={`${INPUT_BASE} ${INPUT_OK} tabular-nums`}
                    />
                  </Field>
                </div>

                <Field label="Slot Duration" hint="minutes per appointment" htmlFor="doctor-slot">
                  <input
                    id="doctor-slot"
                    type="number"
                    name="slotDuration"
                    value={form.slotDuration}
                    onChange={handleChange}
                    min="5"
                    className={`${INPUT_BASE} ${INPUT_OK} tabular-nums`}
                  />
                  <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                    Determines how many appointment slots are generated per day.
                  </p>
                </Field>

                <Field label="Working Days">
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((day) => {
                      const on = form.workingDays.includes(day);
                      return (
                        <button
                          key={day}
                          type="button"
                          onClick={() => toggleWorkingDay(day)}
                          aria-pressed={on}
                          className={`h-9 px-3.5 rounded-full text-[13px] font-semibold border transition duration-150 active:scale-[0.98] ${
                            on
                              ? "bg-primary-600 border-primary-600 text-white"
                              : "bg-white dark:bg-surface border-slate-300 dark:border-surface-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"
                          }`}
                        >
                          {day.slice(0, 3)}
                        </button>
                      );
                    })}
                  </div>
                </Field>

                <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-slate-200 dark:border-surface-border bg-slate-50 dark:bg-surface">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">Available Today</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                      Doctor can accept bookings immediately
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setForm((p) => ({ ...p, isAvailable: !p.isAvailable }))}
                    className={`relative w-11 h-6 shrink-0 rounded-full transition duration-150 focus:outline-none focus:ring-4 focus:ring-primary-500/10 ${
                      form.isAvailable ? "bg-success-600" : "bg-slate-300 dark:bg-slate-600"
                    }`}
                    role="switch"
                    aria-checked={form.isAvailable}
                    aria-label="Available today"
                  >
                    <span
                      className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-150 ${
                        form.isAvailable ? "translate-x-6" : "translate-x-1"
                      }`}
                    />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>

          {/* ── Submit ── */}
          <div className="flex items-center justify-end gap-3 mt-6">
            {!isEmbedded && (
              <button
                type="button"
                onClick={() => navigate("/admin-dashboard")}
                className="inline-flex items-center justify-center h-11 px-5 rounded-full border border-slate-300 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 active:scale-[0.98] transition duration-150"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 h-11 px-5 min-w-[200px] rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? (
                <>
                  <CircleNotch weight="bold" className="w-4 h-4 animate-spin" aria-hidden />
                  Creating…
                </>
              ) : (
                <>
                  <UserPlus weight="bold" className="w-4 h-4" aria-hidden />
                  Create Doctor Account
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddDoctor;
