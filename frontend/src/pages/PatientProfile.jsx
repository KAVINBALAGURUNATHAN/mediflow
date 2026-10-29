import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import {
  PencilSimple,
  Lock,
  CalendarPlus,
  FileArrowDown,
  Phone as PhoneIcon,
} from "@phosphor-icons/react";
import API from "../api/api";
import usePatientData from "../hooks/usePatientData";
import { useToast } from "../context/ToastContext";

const GENDERS = ["Male", "Female", "Other"];
const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

// Phone and email are intentionally absent: phone is the key appointments are
// looked up by, and email identifies Google-linked accounts, so neither is
// editable here (the backend rejects them too - see EDITABLE_FIELDS).
const COMPLETION_FIELDS = ["name", "dob", "gender", "bloodGroup", "address"];

function completionPercent(patient) {
  if (!patient) return 0;
  const filled = COMPLETION_FIELDS.filter((f) => patient[f]).length;
  const hasEmergency = !!patient.emergencyContact?.phone;
  return Math.round(((filled + (hasEmergency ? 1 : 0)) / (COMPLETION_FIELDS.length + 1)) * 100);
}

function missingLabels(patient) {
  if (!patient) return [];
  const labels = { dob: "date of birth", gender: "gender", bloodGroup: "blood group", address: "address" };
  const missing = Object.keys(labels).filter((f) => !patient[f]).map((f) => labels[f]);
  if (!patient.emergencyContact?.phone) missing.push("emergency contact");
  return missing;
}

function toDateInput(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}

const fieldCls =
  "w-full h-11 px-3.5 rounded-lg border border-slate-300 dark:border-surface-border bg-white dark:bg-surface-card text-[15px] text-slate-900 dark:text-white placeholder:text-slate-400 outline-none transition duration-150 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 disabled:bg-slate-50 dark:disabled:bg-surface disabled:text-slate-500";
const labelCls = "block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5";

function Row({ label, children }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function PatientProfile() {
  const { patient, loading } = usePatientData();
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(null);

  const [changingPw, setChangingPw] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });

  const handleChangePassword = async (e) => {
    e.preventDefault();
    if (pwForm.newPassword.length < 8) {
      toast.warning("New password must be at least 8 characters.");
      return;
    }
    if (pwForm.newPassword !== pwForm.confirmPassword) {
      toast.warning("New passwords do not match.");
      return;
    }
    try {
      setPwSaving(true);
      await API.patch("/patient/change-password", {
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      toast.success("Password changed.");
      setPwForm({ currentPassword: "", newPassword: "", confirmPassword: "" });
      setChangingPw(false);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not change your password");
    } finally {
      setPwSaving(false);
    }
  };

  // Seed the form once the profile arrives, and re-seed whenever a save
  // returns fresh values so Cancel always reverts to what's stored.
  useEffect(() => {
    if (!patient) return;
    setForm({
      name: patient.name || "",
      dob: toDateInput(patient.dob),
      gender: patient.gender || "",
      bloodGroup: patient.bloodGroup || "",
      address: patient.address || "",
      emergencyContact: {
        name: patient.emergencyContact?.name || "",
        phone: patient.emergencyContact?.phone || "",
        relationship: patient.emergencyContact?.relationship || "",
      },
    });
  }, [patient]);

  const [saved, setSaved] = useState(null);
  const current = saved || patient;
  const percent = completionPercent(current);
  const missing = missingLabels(current);

  const change = (e) => setForm({ ...form, [e.target.name]: e.target.value });
  const changeEmergency = (e) =>
    setForm({ ...form, emergencyContact: { ...form.emergencyContact, [e.target.name]: e.target.value } });

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.warning("Please enter your name.");
      return;
    }
    if (form.emergencyContact.phone && !/^[6-9]\d{9}$/.test(form.emergencyContact.phone.trim())) {
      toast.warning("Emergency contact must be a valid 10-digit mobile number.");
      return;
    }
    try {
      setSaving(true);
      const res = await API.patch("/patient/profile", form);
      setSaved(res.data.patient);
      setEditing(false);
      toast.success("Profile updated.");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update your profile");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-slate-600 dark:text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  const memberSince = current?.createdAt
    ? new Date(current.createdAt).toLocaleDateString("en-IN", { month: "short", year: "numeric" })
    : null;

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-3xl mx-auto">
        {/* HEADER */}
        <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 animate-slide-up">
          <div>
            <h1 className="page-heading mb-2">
              Welcome back, {(current?.name || "").split(" ")[0] || "there"}
            </h1>
            <p className="page-subheading">
              Manage your appointments, medical reports, and personal information securely.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            {!editing && (
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150"
              >
                <PencilSimple weight="bold" className="w-4 h-4" />
                Edit profile
              </button>
            )}
            {/* Inline rather than a link to /settings - that route is behind
                DoctorProtectedRoute, so it would bounce a patient to the
                doctor login. */}
            <button
              type="button"
              onClick={() => setChangingPw((v) => !v)}
              className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-slate-300 dark:border-surface-border text-slate-700 dark:text-slate-200 text-sm font-medium hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150"
            >
              <Lock weight="duotone" className="w-4 h-4" />
              Change password
            </button>
          </div>
        </div>

        {/* IDENTITY CARD */}
        <div className="glass-card p-6 sm:p-8 rounded-2xl mb-5 animate-slide-up">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 bg-primary-600 rounded-2xl flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xl">
                {(current?.name || "?").trim().charAt(0).toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-lg font-bold text-slate-900 dark:text-white truncate">{current?.name}</p>
              <p className="text-sm text-slate-500 dark:text-slate-500 font-mono">{current?.patientId}</p>
            </div>
          </div>

          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-slate-200/70 dark:border-surface-border">
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-500">Blood group</dt>
              <dd className="font-semibold text-slate-900 dark:text-white mt-0.5">
                {current?.bloodGroup || "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500 dark:text-slate-500">Phone</dt>
              <dd className="font-semibold text-slate-900 dark:text-white mt-0.5 font-mono text-sm">
                {current?.phone}
              </dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-slate-500 dark:text-slate-500">Email</dt>
              <dd className="font-semibold text-slate-900 dark:text-white mt-0.5 text-sm truncate">
                {current?.email || "—"}
              </dd>
            </div>
            {memberSince && (
              <div>
                <dt className="text-xs text-slate-500 dark:text-slate-500">Member since</dt>
                <dd className="font-semibold text-slate-900 dark:text-white mt-0.5">{memberSince}</dd>
              </div>
            )}
          </dl>

          {/* COMPLETION */}
          <div className="mt-6 pt-6 border-t border-slate-200/70 dark:border-surface-border">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Profile completion</p>
              <p className="text-sm font-semibold text-primary-600 dark:text-primary-400 font-mono">{percent}%</p>
            </div>
            <div
              className="h-2 rounded-full bg-slate-200 dark:bg-surface overflow-hidden"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div
                className="h-full bg-primary-600 rounded-full transition-[width] duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
            {missing.length > 0 && (
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-2">
                Add your {missing.join(", ")} to complete your profile.
              </p>
            )}
          </div>
        </div>

        {/* CHANGE PASSWORD */}
        {changingPw && (
          <form onSubmit={handleChangePassword} className="glass-card p-6 sm:p-8 rounded-2xl mb-5 animate-slide-up">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-5">Change password</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Row label="Current password">
                <input
                  type="password"
                  value={pwForm.currentPassword}
                  onChange={(e) => setPwForm({ ...pwForm, currentPassword: e.target.value })}
                  autoComplete="current-password"
                  className={fieldCls}
                />
              </Row>
              <Row label="New password">
                <input
                  type="password"
                  value={pwForm.newPassword}
                  onChange={(e) => setPwForm({ ...pwForm, newPassword: e.target.value })}
                  autoComplete="new-password"
                  placeholder="At least 8 characters"
                  className={fieldCls}
                />
              </Row>
              <Row label="Confirm new password">
                <input
                  type="password"
                  value={pwForm.confirmPassword}
                  onChange={(e) => setPwForm({ ...pwForm, confirmPassword: e.target.value })}
                  autoComplete="new-password"
                  className={fieldCls}
                />
              </Row>
            </div>
            <div className="flex gap-2 mt-6">
              <button
                type="button"
                onClick={() => setChangingPw(false)}
                className="h-11 px-5 rounded-full border border-slate-300 dark:border-surface-border text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pwSaving}
                className="h-11 px-6 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-60 disabled:pointer-events-none"
              >
                {pwSaving ? "Saving…" : "Update password"}
              </button>
            </div>
          </form>
        )}

        {/* DETAILS */}
        <form onSubmit={handleSave} className="glass-card p-6 sm:p-8 rounded-2xl mb-5 animate-slide-up">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-5">Personal details</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Row label="Full name">
              <input name="name" value={form.name} onChange={change} disabled={!editing} className={fieldCls} />
            </Row>
            <Row label="Date of birth">
              <input
                type="date"
                name="dob"
                value={form.dob}
                onChange={change}
                disabled={!editing}
                max={new Date().toISOString().slice(0, 10)}
                className={fieldCls}
              />
            </Row>
            <Row label="Gender">
              <select name="gender" value={form.gender} onChange={change} disabled={!editing} className={fieldCls}>
                <option value="">Not specified</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>{g}</option>
                ))}
              </select>
            </Row>
            <Row label="Blood group">
              <select name="bloodGroup" value={form.bloodGroup} onChange={change} disabled={!editing} className={fieldCls}>
                <option value="">Not specified</option>
                {BLOOD_GROUPS.map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </Row>
            <div className="sm:col-span-2">
              <Row label="Address">
                <input name="address" value={form.address} onChange={change} disabled={!editing} className={fieldCls} placeholder="House, street, area, city" />
              </Row>
            </div>
          </div>

          <h2 className="text-base font-semibold text-slate-900 dark:text-white mt-8 mb-1">Emergency contact</h2>
          <p className="text-xs text-slate-500 dark:text-slate-500 mb-4">
            Who we should reach if you cannot be contacted during a visit.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Row label="Name">
              <input name="name" value={form.emergencyContact.name} onChange={changeEmergency} disabled={!editing} className={fieldCls} />
            </Row>
            <Row label="Phone">
              <input name="phone" value={form.emergencyContact.phone} onChange={changeEmergency} disabled={!editing} className={fieldCls} placeholder="10-digit mobile" />
            </Row>
            <Row label="Relationship">
              <input name="relationship" value={form.emergencyContact.relationship} onChange={changeEmergency} disabled={!editing} className={fieldCls} placeholder="e.g. Spouse" />
            </Row>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-500 mt-5">
            Phone and email can't be changed here — your appointment history is linked to them. Contact the
            front desk if either is wrong.
          </p>

          {editing && (
            <div className="flex gap-2 mt-6 pt-6 border-t border-slate-200/70 dark:border-surface-border">
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setForm({
                    name: current.name || "",
                    dob: toDateInput(current.dob),
                    gender: current.gender || "",
                    bloodGroup: current.bloodGroup || "",
                    address: current.address || "",
                    emergencyContact: {
                      name: current.emergencyContact?.name || "",
                      phone: current.emergencyContact?.phone || "",
                      relationship: current.emergencyContact?.relationship || "",
                    },
                  });
                }}
                className="h-11 px-5 rounded-full border border-slate-300 dark:border-surface-border text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-surface transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 sm:flex-none h-11 px-6 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-60 disabled:pointer-events-none"
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </form>

        {/* QUICK ACTIONS - only routes that actually exist */}
        <div className="glass-card p-6 sm:p-8 rounded-2xl animate-slide-up">
          <h2 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Quick actions</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { to: "/doctors", label: "Book appointment", Icon: CalendarPlus },
              { to: "/medical-reports", label: "Medical reports", Icon: FileArrowDown },
              { to: "/contact", label: "Contact hospital", Icon: PhoneIcon },
            ].map(({ to, label, Icon }) => (
              <Link
                key={to}
                to={to}
                className="flex items-center gap-3 p-4 rounded-xl border border-slate-200/70 dark:border-surface-border hover:border-primary-300 hover:bg-primary-50/40 dark:hover:bg-surface transition-colors duration-200"
              >
                <Icon weight="duotone" className="w-5 h-5 text-primary-600 shrink-0" />
                <span className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default PatientProfile;
