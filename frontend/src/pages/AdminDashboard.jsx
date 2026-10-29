import { useEffect, useState, useRef, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  SquaresFour,
  Stethoscope,
  Headset,
  UserPlus,
  CalendarBlank,
  Users,
  Flask,
  CheckCircle,
  CurrencyInr,
  Clock,
  SignOut,
  List,
  X,
  DotsThreeVertical,
  PencilSimple,
  Trash,
  Eye,
  EyeSlash,
  CircleNotch,
  ArrowRight,
  ShieldCheck,
  Plus,
} from "@phosphor-icons/react";
import API from "../api/api";
import AddDoctor from "./AddDoctor";
import ConfirmModal from "../components/ConfirmModal";
import { useToast } from "../context/ToastContext";
import { getStatusBadgeClass } from "../utils/statusBadge";
import useFirstMountThisSession from "../hooks/useFirstMountThisSession";
import useMasterLists from "../hooks/useMasterLists";
import MasterListSelect from "../components/MasterListSelect";

/* ── small helpers ───────────────────────────────────────────── */
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
const DEFAULT_WORKING_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const NAV = [
  { id: "dashboard", label: "Overview", Icon: SquaresFour },
  { id: "manage", label: "Doctors", Icon: Stethoscope },
  { id: "receptionists", label: "Receptionists", Icon: Headset },
  { id: "add", label: "Add Doctor", Icon: UserPlus },
  { id: "appointments", label: "Appointments", Icon: CalendarBlank },
  // Routed page rather than an in-page tab (see navTo) - the patient list
  // has its own pagination and search state, which does not belong in this
  // already-large dashboard component.
  { id: "patients", label: "Patients", Icon: Users, route: "/admin/patients" },
  // Same reasoning: the catalog has its own create/edit form state.
  { id: "lab-tests", label: "Lab Tests", Icon: Flask, route: "/admin/lab-tests" },
];

/* ── shared surface + control treatments (mirrors PatientDashboard /
   Analytics so the admin console reads as the same product) ── */
const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const INPUT =
  "w-full h-11 px-3.5 rounded-lg text-sm bg-white dark:bg-surface text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-500 border border-slate-300 dark:border-surface-border focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none transition duration-150";
const PILL_PRIMARY =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none";
const PILL_OUTLINE =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-slate-300 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 active:scale-[0.98] transition duration-150";
const TH =
  "text-left text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 px-5 py-3 border-b border-slate-200 dark:border-surface-border whitespace-nowrap";
const TD = "px-5 py-3.5 border-b border-slate-100 dark:border-surface-border";

function StatCard({ label, value, caption, Icon, tone }) {
  return (
    <div className={`${CARD} p-5`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${tone}`}>
        <Icon weight="duotone" className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-[28px] leading-none font-bold font-mono text-slate-900 dark:text-white">{value}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">{label}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{caption}</p>
    </div>
  );
}

/* ── field wrapper ── */
function Field({ label, hint, htmlFor, children }) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
      >
        {label}
        {hint && (
          <span className="ml-2 text-xs font-normal text-slate-500 dark:text-slate-400">{hint}</span>
        )}
      </label>
      {children}
    </div>
  );
}

/* ── section header inside a form ── */
function FormSection({ title, children }) {
  return (
    <div className="space-y-4">
      <h3 className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 pb-2 border-b border-slate-100 dark:border-surface-border">
        {title}
      </h3>
      {children}
    </div>
  );
}

/* ── compact empty state: icon + copy + action on one line, never a
   full-height empty box ── */
function EmptyState({ Icon, title, description, action, tone = "bg-primary-50 text-primary-600 dark:bg-primary-500/10" }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-4 rounded-2xl border border-dashed border-slate-300 dark:border-surface-border p-5">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
        <Icon weight="duotone" className="w-6 h-6" aria-hidden />
      </div>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 dark:text-white">{title}</p>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{description}</p>
      </div>
      {action}
    </div>
  );
}

function TableSkeleton({ rows = 5, cols = 6 }) {
  return (
    <div className="p-5 space-y-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className="h-4 flex-1 rounded bg-slate-100 dark:bg-surface animate-pulse"
              style={{ maxWidth: c === 0 ? "none" : `${90 - c * 8}px` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

/* ── Edit Doctor slide-over panel ── */
function EditDoctorPanel({ doctor, onClose, onSaved }) {
  const toast = useToast();
  const reduceMotion = useReducedMotion();
  const [saving, setSaving] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const { specializations, hospitals, reloadLists } = useMasterLists();
  const [d, setD] = useState(() => ({
    ...doctor,
    qualification: doctor.qualification || "",
    // GET /admin/doctors uses .lean(), which skips schema defaults for
    // documents saved before workingDays existed - fall back here so the
    // checkboxes below reflect the same Mon-Sat default the public
    // GET /doctors endpoints already apply for these older records.
    workingDays: doctor.workingDays?.length ? doctor.workingDays : DEFAULT_WORKING_DAYS,
    // Doctors created before the master-list system (or via free-text
    // legacy callers) won't have these set - the dropdowns below just
    // start unselected and the admin picks the correct entry once.
    specializationId: doctor.specializationId || "",
    hospitalId: doctor.hospitalId || "",
  }));

  const set = (k, v) => setD((prev) => ({ ...prev, [k]: v }));
  const setHours = (k, v) =>
    setD((prev) => ({ ...prev, workingHours: { ...prev.workingHours, [k]: v } }));
  const toggleWorkingDay = (day) =>
    setD((prev) => ({
      ...prev,
      workingDays: prev.workingDays.includes(day)
        ? prev.workingDays.filter((x) => x !== day)
        : [...prev.workingDays, day],
    }));

  const save = async (e) => {
    e.preventDefault();
    try {
      setSaving(true);
      await API.put(`/admin/doctors/${d._id}`, {
        name: d.name,
        email: d.email,
        specializationId: d.specializationId,
        experience: Number(d.experience),
        consultationFee: Number(d.consultationFee),
        hospitalId: d.hospitalId,
        workingHoursStart: d.workingHours?.start,
        workingHoursEnd: d.workingHours?.end,
        slotDuration: Number(d.slotDuration),
        isAvailable: d.isAvailable,
        qualification: d.qualification,
        workingDays: d.workingDays,
        ...(d.password ? { password: d.password } : {}),
      });
      toast.success("Doctor profile updated successfully.");
      onSaved();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to update doctor.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end" role="dialog" aria-modal="true">
      <motion.div
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="absolute inset-0 bg-slate-900/40 dark:bg-slate-950/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, x: 28 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
        className="relative w-full max-w-lg h-full bg-white dark:bg-surface-card border-l border-slate-200 dark:border-surface-border shadow-2xl overflow-y-auto flex flex-col"
      >
        {/* header */}
        <div className="sticky top-0 z-10 bg-white dark:bg-surface-card border-b border-slate-200 dark:border-surface-border px-6 py-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary-600 dark:text-primary-400">
              Admin · Edit
            </p>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white mt-0.5 truncate">
              Doctor Profile
            </h2>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 grid place-items-center rounded-lg border border-slate-300 dark:border-surface-border text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5 transition duration-150 shrink-0"
            aria-label="Close panel"
          >
            <X weight="bold" className="w-4 h-4" aria-hidden />
          </button>
        </div>

        <form onSubmit={save} id="edit-doctor-form" className="flex-1 p-6 space-y-6">
          <FormSection title="Account">
            <Field label="Full Name" htmlFor="edit-name">
              <input
                id="edit-name"
                type="text"
                value={d.name}
                onChange={(e) => set("name", e.target.value)}
                required
                className={INPUT}
              />
            </Field>
            <Field label="Email" htmlFor="edit-email">
              <input
                id="edit-email"
                type="email"
                value={d.email}
                onChange={(e) => set("email", e.target.value)}
                required
                className={INPUT}
              />
            </Field>
            <Field label="New Password" hint="Leave blank to keep unchanged" htmlFor="edit-password">
              <div className="relative">
                <input
                  id="edit-password"
                  type={showPw ? "text" : "password"}
                  value={d.password || ""}
                  onChange={(e) => set("password", e.target.value)}
                  placeholder="••••••••"
                  className={`${INPUT} pr-11`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-white/5 transition duration-150"
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? (
                    <EyeSlash weight="duotone" className="w-[18px] h-[18px]" aria-hidden />
                  ) : (
                    <Eye weight="duotone" className="w-[18px] h-[18px]" aria-hidden />
                  )}
                </button>
              </div>
            </Field>
          </FormSection>

          <FormSection title="Professional">
            <MasterListSelect
              label="Specialization"
              required
              options={specializations}
              value={d.specializationId}
              onChange={(id) => set("specializationId", id)}
              createEndpoint="/admin/specializations"
              responseKey="specialization"
              onCreated={reloadLists}
              placeholder="Select specialization…"
              addLabel="Add specialization"
              namePlaceholder="e.g. Cardiology"
            />
            <Field
              label="Qualification"
              hint="shown on the doctor's public profile"
              htmlFor="edit-qualification"
            >
              <input
                id="edit-qualification"
                type="text"
                value={d.qualification}
                onChange={(e) => set("qualification", e.target.value)}
                placeholder="e.g. MBBS, MD"
                className={INPUT}
              />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Experience (yrs)" htmlFor="edit-experience">
                <input
                  id="edit-experience"
                  type="number"
                  value={d.experience}
                  onChange={(e) => set("experience", e.target.value)}
                  required
                  min="0"
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
              <Field label="Fee (₹)" htmlFor="edit-fee">
                <input
                  id="edit-fee"
                  type="number"
                  value={d.consultationFee}
                  onChange={(e) => set("consultationFee", e.target.value)}
                  required
                  min="0"
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
            </div>
            <MasterListSelect
              label="Clinic / Hospital"
              required
              options={hospitals}
              value={d.hospitalId}
              onChange={(id) => set("hospitalId", id)}
              createEndpoint="/admin/hospitals"
              responseKey="hospital"
              onCreated={reloadLists}
              placeholder="Select hospital…"
              addLabel="Add hospital"
              namePlaceholder="e.g. Apollo Hospital, Mumbai"
            />
          </FormSection>

          <FormSection title="Schedule">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start Time" htmlFor="edit-start">
                <input
                  id="edit-start"
                  type="time"
                  value={d.workingHours?.start || "09:00"}
                  onChange={(e) => setHours("start", e.target.value)}
                  required
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
              <Field label="End Time" htmlFor="edit-end">
                <input
                  id="edit-end"
                  type="time"
                  value={d.workingHours?.end || "17:00"}
                  onChange={(e) => setHours("end", e.target.value)}
                  required
                  className={`${INPUT} tabular-nums`}
                />
              </Field>
            </div>
            <Field label="Slot Duration (min)" htmlFor="edit-slot">
              <input
                id="edit-slot"
                type="number"
                value={d.slotDuration}
                onChange={(e) => set("slotDuration", e.target.value)}
                required
                min="5"
                className={`${INPUT} tabular-nums`}
              />
            </Field>
            <Field label="Working Days">
              <div className="flex flex-wrap gap-2">
                {WEEKDAYS.map((day) => {
                  const on = d.workingDays.includes(day);
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
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Available today</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Doctor can accept bookings immediately
                </p>
              </div>
              <button
                type="button"
                onClick={() => set("isAvailable", !d.isAvailable)}
                role="switch"
                aria-checked={d.isAvailable}
                aria-label="Available today"
                className={`relative w-11 h-6 shrink-0 rounded-full transition duration-150 focus:outline-none focus:ring-4 focus:ring-primary-500/10 ${
                  d.isAvailable ? "bg-success-600" : "bg-slate-300 dark:bg-slate-600"
                }`}
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform duration-150 ${
                    d.isAvailable ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>
          </FormSection>
        </form>

        <div className="sticky bottom-0 bg-white dark:bg-surface-card border-t border-slate-200 dark:border-surface-border px-6 py-4">
          <button type="submit" form="edit-doctor-form" disabled={saving} className={`${PILL_PRIMARY} w-full`}>
            {saving ? (
              <>
                <CircleNotch weight="bold" className="w-4 h-4 animate-spin" aria-hidden />
                Saving…
              </>
            ) : (
              "Save Changes"
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function DoctorRow({ doc, onEdit, onDelete, index, reduceMotion }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0 });

  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useLayoutEffect(() => {
    if (!menuOpen || !menuRef.current || !buttonRef.current) return;

    const menuRect = menuRef.current.getBoundingClientRect();
    const buttonRect = buttonRef.current.getBoundingClientRect();
    const gap = 6;

    let top = buttonRect.bottom + gap;
    let left = buttonRect.right - menuRect.width;

    if (top + menuRect.height > window.innerHeight) {
      top = buttonRect.top - menuRect.height - gap;
    }
    if (top < 8) {
      top = buttonRect.bottom + gap;
    }
    if (left + menuRect.width > window.innerWidth) {
      left = window.innerWidth - menuRect.width - 8;
    }
    if (left < 8) {
      left = 8;
    }

    setMenuPosition({ top, left });
  }, [menuOpen]);

  const openMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!buttonRef.current) return;
    const rect = buttonRef.current.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 6, left: rect.right - 160 });
    setMenuOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handleOutsideClick = (e) => {
      const clickedButton = buttonRef.current?.contains(e.target);
      const clickedMenu = menuRef.current?.contains(e.target);
      if (!clickedButton && !clickedMenu) setMenuOpen(false);
    };
    const closeMenu = () => setMenuOpen(false);
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
    };
  }, [menuOpen]);

  const handleEditClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    onEdit(doc);
  };

  const handleDeleteClick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    onDelete(doc);
  };

  return (
    <>
      <motion.tr
        initial={reduceMotion ? false : { opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : Math.min(index, 12) * 0.03 }}
        className="hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors duration-150"
      >
        <td className={TD}>
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary-600 flex items-center justify-center shrink-0">
              <span className="text-white text-sm font-bold">
                {(doc.name || "D").trim().charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{doc.name}</p>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{doc.email}</p>
            </div>
          </div>
        </td>
        <td className={TD}>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-[12.5px] font-bold bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300 whitespace-nowrap">
            {doc.specialization}
          </span>
        </td>
        <td className={`${TD} text-sm text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap`}>
          {doc.experience} yrs
        </td>
        <td className={`${TD} text-right text-sm font-semibold text-slate-900 dark:text-white tabular-nums whitespace-nowrap`}>
          ₹{doc.consultationFee}
        </td>
        <td className={`${TD} text-sm text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap`}>
          {doc.workingHours?.start} – {doc.workingHours?.end}
        </td>
        <td className={TD}>
          {doc.isAvailable ? (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12.5px] font-bold bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-success-500" aria-hidden />
              Active
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[12.5px] font-bold bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-300 whitespace-nowrap">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-400" aria-hidden />
              Inactive
            </span>
          )}
        </td>
        <td className={`${TD} text-right`}>
          <button
            ref={buttonRef}
            type="button"
            onClick={openMenu}
            className="w-9 h-9 grid place-items-center rounded-lg border border-slate-200 dark:border-surface-border text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5 transition duration-150"
            aria-label={`Actions for ${doc.name}`}
          >
            <DotsThreeVertical weight="bold" className="w-4 h-4" aria-hidden />
          </button>
        </td>
      </motion.tr>

      {menuOpen &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, zIndex: 9999 }}
            className={`w-44 ${CARD} py-1 shadow-[0_18px_40px_-12px_rgba(15,23,42,0.28)] overflow-hidden`}
          >
            <button
              type="button"
              onClick={handleEditClick}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors duration-150"
            >
              <PencilSimple weight="duotone" className="w-4 h-4 text-slate-500" aria-hidden />
              Edit Profile
            </button>
            <div className="h-px bg-slate-100 dark:bg-surface-border mx-3 my-1" />
            <button
              type="button"
              onClick={handleDeleteClick}
              className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm font-medium text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition-colors duration-150"
            >
              <Trash weight="duotone" className="w-4 h-4" aria-hidden />
              Delete
            </button>
          </div>,
          document.body
        )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════════
   Main component
══════════════════════════════════════════════════════════════ */
function AdminDashboard() {
  const navigate = useNavigate();
  const toast = useToast();
  const shouldAnimate = useFirstMountThisSession("admin-dashboard");
  const reduceMotion = useReducedMotion();

  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [editingDoctor, setEditingDoctor] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [receptionistForm, setReceptionistForm] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [creatingReceptionist, setCreatingReceptionist] = useState(false);
  const [showReceptionistPassword, setShowReceptionistPassword] = useState(false);
  const [appointments, setAppointments] = useState([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(true);

  const admin = (() => { try { return JSON.parse(localStorage.getItem("admin")); } catch { return null; } })();

  useEffect(() => { fetchDoctors(); fetchAppointments(); }, []);

  const fetchDoctors = async () => {
    try {
      setLoading(true);
      const res = await API.get("/admin/doctors");
      setDoctors(res.data.doctors || []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load doctors.");
    } finally {
      setLoading(false);
    }
  };

  const fetchAppointments = async () => {
    try {
      setAppointmentsLoading(true);
      const res = await API.get("/admin/appointments");
      setAppointments(res.data.appointments || []);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to load appointments.");
    } finally {
      setAppointmentsLoading(false);
    }
  };

  const confirmDeleteAppointment = (appt) => {
    setConfirmModal({
      title: "Delete Appointment",
      message: `Permanently delete the appointment for ${appt.patientName}? This cannot be undone (use Cancel instead if you just want to stop it without losing the record).`,
      variant: "danger",
      confirmLabel: "Delete Appointment",
      onConfirm: () => doDeleteAppointment(appt._id),
    });
  };

  const doDeleteAppointment = async (id) => {
    try {
      await API.delete(`/admin/appointments/${id}`);
      toast.success("Appointment deleted.");
      fetchAppointments();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete appointment.");
    }
  };

  const confirmDelete = (doc) => {
    console.log("CONFIRM MODAL OPENED", doc._id);
    setConfirmModal({
      title: "Delete Doctor Account",
      message: `This will permanently delete Dr. ${doc.name}'s account and all their appointments. This cannot be undone.`,
      variant: "danger",
      confirmLabel: "Delete Doctor",
      onConfirm: () => doDelete(doc._id, doc.name),
    });
  };

  const doDelete = async (id, name) => {
    console.log("SENDING DELETE REQUEST", id);
    try {
      await API.delete(`/admin/doctors/${id}`);
      toast.success(`Dr. ${name}'s account has been deleted.`);
      fetchDoctors();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete doctor.");
    }
  };

  const handleLogout = () => {
    setConfirmModal({
      title: "Log out?",
      message: "You will be returned to the admin login page.",
      variant: "warning",
      confirmLabel: "Log out",
      onConfirm: () => {
        // Only the admin session - other roles/patients logged in on the
        // same browser must not be logged out as a side effect.
        localStorage.removeItem("adminToken");
        localStorage.removeItem("admin");
        navigate("/admin-login");
      },
    });
  };

  const handleCreateReceptionist = async (e) => {
    e.preventDefault();

    try {
      setCreatingReceptionist(true);

      await API.post("/admin/receptionists", {
        name: receptionistForm.name.trim(),
        email: receptionistForm.email.trim(),
        password: receptionistForm.password,
      });

      toast.success("Receptionist account created successfully.");

      setReceptionistForm({
        name: "",
        email: "",
        password: "",
      });
    } catch (err) {
      toast.error(
        err.response?.data?.message ||
          err.message ||
          "Failed to create receptionist."
      );
    } finally {
      setCreatingReceptionist(false);
    }
  };

  const totalDoctors = doctors.length;
  const availableDoctors = doctors.filter((d) => d.isAvailable).length;
  const avgFee = totalDoctors > 0 ? Math.round(doctors.reduce((s, d) => s + (d.consultationFee || 0), 0) / totalDoctors) : 0;
  const avgExp = totalDoctors > 0 ? (doctors.reduce((s, d) => s + (d.experience || 0), 0) / totalDoctors).toFixed(1) : 0;

  const navTo = (id) => {
    const target = NAV.find((n) => n.id === id);
    setMobileNavOpen(false);
    if (target?.route) {
      navigate(target.route);
      return;
    }
    setActiveTab(id);
  };

  // Motion is gated on both the per-session first mount and the user's
  // reduced-motion preference.
  const animate = shouldAnimate && !reduceMotion;
  const rise = (delay = 0) => ({
    initial: animate ? { opacity: 0, y: 12 } : false,
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: EASE, delay: animate ? delay : 0 },
  });

  // Every heading below is the copy that already shipped for that tab -
  // hoisted into one place so the page has a single, consistent header.
  const META = {
    dashboard: {
      title: "Dashboard Overview",
      subtitle: "Hospital workforce and availability at a glance.",
      eyebrow: "Admin · Overview",
    },
    manage: {
      title: "Doctor Profiles",
      subtitle: `${totalDoctors} registered · ${availableDoctors} available today`,
      eyebrow: "Admin · Workforce",
    },
    receptionists: {
      title: "Create Receptionist Account",
      subtitle: "Set the receptionist's name, login email, and initial password.",
      eyebrow: "Admin · Staff Onboarding",
    },
    add: {
      title: "Add Doctor Account",
      subtitle: "Register a new doctor with their schedule and clinic details.",
      eyebrow: "Admin · Staff Onboarding",
    },
    appointments: {
      title: "All Appointments",
      subtitle: `${appointments.length} total across every doctor`,
      eyebrow: "Admin · Records",
    },
  };
  const meta = META[activeTab];

  if (loading && doctors.length === 0) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-[1400px] mx-auto">
          <div className="h-4 w-32 bg-slate-100 dark:bg-surface rounded animate-pulse mb-3" />
          <div className="h-10 w-72 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-96 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className="h-12 w-full max-w-xl bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl animate-pulse mb-8" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-[148px] bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl animate-pulse"
              />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            {Array.from({ length: 2 }).map((_, i) => (
              <div
                key={i}
                className="h-24 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-[1400px] mx-auto">
        {/* ── Page header ── */}
        <motion.header
          {...rise(0)}
          className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-6"
        >
          <div className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-[0.12em] text-primary-600 dark:text-primary-400 mb-2">
              {meta.eyebrow}
            </p>
            <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
              {meta.title}
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">{meta.subtitle}</p>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="hidden sm:flex items-center gap-2.5 pr-1">
              <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                <ShieldCheck weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 leading-none">
                  Signed in
                </p>
                <p className="text-sm font-semibold text-slate-900 dark:text-white truncate max-w-[200px]">
                  {admin?.email || "Administrator"}
                </p>
              </div>
            </div>
            {(activeTab === "dashboard" || activeTab === "manage") && (
              <button type="button" onClick={() => navTo("add")} className={PILL_PRIMARY}>
                <Plus weight="bold" className="w-4 h-4" aria-hidden />
                Add Doctor
              </button>
            )}
            <button type="button" onClick={handleLogout} className={`${PILL_OUTLINE} hidden sm:inline-flex`}>
              <SignOut weight="bold" className="w-4 h-4" aria-hidden />
              Log out
            </button>
          </div>
        </motion.header>

        {/* ── Tabs ── */}
        <motion.div {...rise(0.04)} className="mb-8">
          <div className="flex items-center gap-2">
            <nav
              className={`${CARD} hidden md:flex items-center gap-1 p-1.5 rounded-2xl`}
              aria-label="Admin sections"
            >
              {NAV.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => navTo(n.id)}
                  aria-current={activeTab === n.id ? "page" : undefined}
                  className={`inline-flex items-center gap-2 h-9 px-4 rounded-full text-[13px] font-semibold transition duration-150 ${
                    activeTab === n.id
                      ? "bg-primary-600 text-white"
                      : "text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/5"
                  }`}
                >
                  <n.Icon weight="duotone" className="w-4 h-4" aria-hidden />
                  {n.label}
                </button>
              ))}
            </nav>

            {/* Mobile nav toggle */}
            <button
              type="button"
              onClick={() => setMobileNavOpen(!mobileNavOpen)}
              aria-expanded={mobileNavOpen}
              className={`${PILL_OUTLINE} md:hidden`}
            >
              {mobileNavOpen ? (
                <X weight="bold" className="w-4 h-4" aria-hidden />
              ) : (
                <List weight="bold" className="w-4 h-4" aria-hidden />
              )}
              Sections
            </button>
          </div>

          {/* Mobile nav dropdown */}
          {mobileNavOpen && (
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE }}
              className={`${CARD} md:hidden mt-3 p-2 space-y-1`}
            >
              {NAV.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => navTo(n.id)}
                  className={`w-full flex items-center gap-3 h-11 px-4 rounded-xl text-sm font-semibold transition duration-150 ${
                    activeTab === n.id
                      ? "bg-primary-50 text-primary-700 dark:bg-primary-500/10 dark:text-primary-300"
                      : "text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5"
                  }`}
                >
                  <n.Icon weight="duotone" className="w-5 h-5" aria-hidden />
                  {n.label}
                </button>
              ))}
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 h-11 px-4 rounded-xl text-sm font-semibold text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition duration-150"
              >
                <SignOut weight="bold" className="w-5 h-5" aria-hidden />
                Log out
              </button>
            </motion.div>
          )}
        </motion.div>

        {/* ── OVERVIEW ── */}
        {activeTab === "dashboard" && (
          <div className="space-y-8">
            <motion.section
              {...rise(0.08)}
              className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5"
              aria-label="Workforce metrics"
            >
              <StatCard
                label="Total doctors"
                value={totalDoctors}
                caption="Registered accounts"
                Icon={Users}
                tone="bg-primary-50 text-primary-600 dark:bg-primary-500/10"
              />
              <StatCard
                label="Available today"
                value={availableDoctors}
                caption={
                  totalDoctors > 0
                    ? `${totalDoctors - availableDoctors} currently unavailable`
                    : "No doctors registered yet"
                }
                Icon={CheckCircle}
                tone="bg-success-50 text-success-600 dark:bg-success-500/10"
              />
              <StatCard
                label="Average fee"
                value={`₹${avgFee}`}
                caption="Across all consultations"
                Icon={CurrencyInr}
                tone="bg-warning-50 text-warning-600 dark:bg-warning-500/10"
              />
              <StatCard
                label="Average experience"
                value={`${avgExp}`}
                caption="Years, across all doctors"
                Icon={Clock}
                tone="bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10"
              />
            </motion.section>

            {/* Quick actions */}
            <motion.section {...rise(0.12)} className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <button
                type="button"
                onClick={() => navTo("manage")}
                className={`${CARD} group p-5 flex items-center gap-4 text-left hover:border-slate-300 dark:hover:border-slate-600 transition duration-150`}
              >
                <div className="w-11 h-11 rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                  <Stethoscope weight="duotone" className="w-6 h-6" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">Manage doctors</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    {totalDoctors} registered · {availableDoctors} active today
                  </p>
                </div>
                <ArrowRight
                  weight="bold"
                  className="w-4 h-4 text-slate-500 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>

              <button
                type="button"
                onClick={() => navTo("add")}
                className={`${CARD} group p-5 flex items-center gap-4 text-left hover:border-slate-300 dark:hover:border-slate-600 transition duration-150`}
              >
                <div className="w-11 h-11 rounded-xl bg-success-50 text-success-600 dark:bg-success-500/10 flex items-center justify-center shrink-0">
                  <UserPlus weight="duotone" className="w-6 h-6" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-slate-900 dark:text-white">Add new doctor</p>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                    Onboard a new doctor account
                  </p>
                </div>
                <ArrowRight
                  weight="bold"
                  className="w-4 h-4 text-slate-500 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
                  aria-hidden
                />
              </button>
            </motion.section>
          </div>
        )}

        {/* ── RECEPTIONISTS ── */}
        {activeTab === "receptionists" && (
          <motion.div {...rise(0.08)} className={`${CARD} max-w-2xl p-6`}>
            <form onSubmit={handleCreateReceptionist} className="space-y-6">
              <FormSection title="Receptionist Login Details">
                <Field label="Full Name" htmlFor="receptionist-name">
                  <input
                    id="receptionist-name"
                    type="text"
                    value={receptionistForm.name}
                    onChange={(e) =>
                      setReceptionistForm((prev) => ({
                        ...prev,
                        name: e.target.value,
                      }))
                    }
                    required
                    className={INPUT}
                    placeholder="Main Receptionist"
                  />
                </Field>

                <Field label="Email Address" htmlFor="receptionist-email">
                  <input
                    id="receptionist-email"
                    type="email"
                    value={receptionistForm.email}
                    onChange={(e) =>
                      setReceptionistForm((prev) => ({
                        ...prev,
                        email: e.target.value,
                      }))
                    }
                    required
                    className={INPUT}
                    placeholder="receptionist@hospital.com"
                  />
                </Field>

                <Field
                  label="Initial Password"
                  hint="The receptionist will use this to log in"
                  htmlFor="receptionist-password"
                >
                  <div className="relative">
                    <input
                      id="receptionist-password"
                      type={showReceptionistPassword ? "text" : "password"}
                      value={receptionistForm.password}
                      onChange={(e) =>
                        setReceptionistForm((prev) => ({
                          ...prev,
                          password: e.target.value,
                        }))
                      }
                      required
                      minLength={6}
                      className={`${INPUT} pr-11`}
                      placeholder="••••••••"
                    />

                    <button
                      type="button"
                      onClick={() =>
                        setShowReceptionistPassword((prev) => !prev)
                      }
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 w-8 h-8 grid place-items-center rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-white/5 transition duration-150"
                      aria-label={
                        showReceptionistPassword
                          ? "Hide password"
                          : "Show password"
                      }
                    >
                      {showReceptionistPassword ? (
                        <EyeSlash weight="duotone" className="w-[18px] h-[18px]" aria-hidden />
                      ) : (
                        <Eye weight="duotone" className="w-[18px] h-[18px]" aria-hidden />
                      )}
                    </button>
                  </div>
                </Field>
              </FormSection>

              <button
                type="submit"
                disabled={creatingReceptionist}
                className={`${PILL_PRIMARY} w-full`}
              >
                {creatingReceptionist ? (
                  <>
                    <CircleNotch weight="bold" className="w-4 h-4 animate-spin" aria-hidden />
                    Creating Receptionist…
                  </>
                ) : (
                  <>
                    <UserPlus weight="bold" className="w-4 h-4" aria-hidden />
                    Create Receptionist Account
                  </>
                )}
              </button>
            </form>
          </motion.div>
        )}

        {/* ── ADD DOCTOR ── */}
        {activeTab === "add" && (
          <AddDoctor isEmbedded onSuccess={() => { navTo("manage"); fetchDoctors(); }} />
        )}

        {/* ── MANAGE DOCTORS ── */}
        {activeTab === "manage" && (
          <motion.section {...rise(0.08)}>
            {doctors.length === 0 ? (
              <EmptyState
                Icon={Stethoscope}
                title="No doctors registered"
                description="Add your first doctor account to get started."
                action={
                  <button type="button" onClick={() => navTo("add")} className={`${PILL_PRIMARY} shrink-0`}>
                    <Plus weight="bold" className="w-4 h-4" aria-hidden />
                    Add first doctor
                  </button>
                }
              />
            ) : (
              <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[900px] border-collapse">
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>Doctor</th>
                        <th scope="col" className={TH}>Specialization</th>
                        <th scope="col" className={TH}>Exp.</th>
                        <th scope="col" className={`${TH} text-right`}>Fee</th>
                        <th scope="col" className={TH}>Hours</th>
                        <th scope="col" className={TH}>Status</th>
                        <th scope="col" className={`${TH} w-16`}>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {doctors.map((doc, i) => (
                        <DoctorRow
                          key={doc._id}
                          doc={doc}
                          index={i}
                          reduceMotion={reduceMotion}
                          onEdit={setEditingDoctor}
                          onDelete={confirmDelete}
                          openUpward={doctors.indexOf(doc) >= doctors.length - 2}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.section>
        )}

        {/* ── APPOINTMENTS ── */}
        {activeTab === "appointments" && (
          <motion.section {...rise(0.08)}>
            {appointmentsLoading ? (
              <div className={`${CARD} overflow-hidden`}>
                <TableSkeleton rows={6} cols={6} />
              </div>
            ) : appointments.length === 0 ? (
              <EmptyState
                Icon={CalendarBlank}
                title="No appointments yet"
                description="Booked appointments will show up here."
              />
            ) : (
              <div className={`${CARD} overflow-hidden`}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[860px] border-collapse">
                    <thead>
                      <tr>
                        <th scope="col" className={TH}>Patient</th>
                        <th scope="col" className={TH}>Doctor</th>
                        <th scope="col" className={TH}>Date</th>
                        <th scope="col" className={TH}>Slot</th>
                        <th scope="col" className={TH}>Status</th>
                        <th scope="col" className={`${TH} text-right`}>
                          <span className="sr-only">Actions</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {appointments.map((appt, i) => (
                        <motion.tr
                          key={appt._id}
                          initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{
                            duration: 0.3,
                            ease: EASE,
                            delay: reduceMotion ? 0 : Math.min(i, 12) * 0.03,
                          }}
                          className="hover:bg-slate-50/70 dark:hover:bg-white/[0.03] transition-colors duration-150"
                        >
                          <td className={TD}>
                            <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">
                              {appt.patientName}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                              {appt.phone}
                            </p>
                          </td>
                          <td className={`${TD} text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap`}>
                            {appt.doctorId?.name || "Unknown"}
                          </td>
                          <td className={`${TD} text-sm text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap`}>
                            {new Date(appt.appointmentDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
                          </td>
                          <td className={`${TD} text-sm text-slate-700 dark:text-slate-300 tabular-nums whitespace-nowrap`}>
                            {appt.slot}
                          </td>
                          <td className={TD}>
                            <span className={getStatusBadgeClass(appt.status)}>
                              {appt.status}
                            </span>
                          </td>
                          <td className={`${TD} text-right`}>
                            <button
                              type="button"
                              onClick={() => confirmDeleteAppointment(appt)}
                              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12.5px] font-bold text-danger-600 dark:text-danger-400 hover:bg-danger-50 dark:hover:bg-danger-500/10 transition duration-150"
                            >
                              <Trash weight="duotone" className="w-4 h-4" aria-hidden />
                              Delete
                            </button>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </motion.section>
        )}
      </div>

      {/* ── Edit panel ── */}
      {editingDoctor && (
        <EditDoctorPanel
          doctor={editingDoctor}
          onClose={() => setEditingDoctor(null)}
          onSaved={() => { setEditingDoctor(null); fetchDoctors(); }}
        />
      )}

      {/* ── Confirm modal ── */}
      <ConfirmModal config={confirmModal} onClose={() => setConfirmModal(null)} />
    </div>
  );
}

export default AdminDashboard;
