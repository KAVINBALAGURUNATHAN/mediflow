import { useState } from "react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";

// Dropdown backed by a master-list collection (Specialization / Hospital),
// with an inline "add new" affordance so an admin can grow the list without
// leaving the form - this is the only place a new entry gets typed in by
// hand, so it's the one place a spelling mistake could still happen, but it
// only happens once per hospital/specialization rather than once per doctor.
function MasterListSelect({
  label,
  required,
  options,
  optionLabel = (o) => o.displayName || o.name,
  value,
  onChange,
  createEndpoint,
  responseKey,
  onCreated,
  error,
  placeholder = "Select…",
  addLabel = "Add new",
  namePlaceholder = "Name",
}) {
  const toast = useToast();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);

  const inputCls = `input mt-1.5 ${error ? "border-danger-400 dark:border-danger-500 focus:ring-danger-400/40 focus:border-danger-400" : ""}`;

  const handleAdd = async () => {
    if (!newName.trim()) return;
    try {
      setSaving(true);
      const res = await API.post(createEndpoint, { name: newName.trim() });
      const created = res.data[responseKey];
      onCreated(created);
      onChange(created._id);
      setNewName("");
      setAdding(false);
      toast.success(`"${created.name}" added.`);
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to add.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
          {label}
          {required && <span className="text-danger-500 ml-0.5">*</span>}
        </label>
        <button
          type="button"
          onClick={() => setAdding((v) => !v)}
          className="text-xs font-semibold text-primary-600 dark:text-primary-400 hover:underline"
        >
          {adding ? "Cancel" : `+ ${addLabel}`}
        </button>
      </div>

      {adding ? (
        <div className="flex gap-2 mt-1.5">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={namePlaceholder}
            className="input"
            autoFocus
          />
          <button
            type="button"
            onClick={handleAdd}
            disabled={saving || !newName.trim()}
            className="btn-outline whitespace-nowrap"
          >
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      ) : (
        <select
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className={inputCls}
          required={required}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((o) => (
            <option key={o._id} value={o._id}>
              {optionLabel(o)}
            </option>
          ))}
        </select>
      )}
      {error && <p className="mt-1 text-xs text-danger-600 dark:text-danger-400">{error}</p>}
    </div>
  );
}

export default MasterListSelect;
