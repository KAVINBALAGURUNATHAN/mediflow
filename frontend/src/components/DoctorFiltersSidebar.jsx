// All filters below operate on fields the backend already returns for a
// doctor (specialization, location, experience, consultationFee,
// isAvailable/availabilityStatus) - purely client-side narrowing of the
// same /doctors response Doctors.jsx already fetches. No rating/gender
// filters are included since no such fields exist anywhere in the backend.
// Deliberately light-only (no dark: classes) - part of the public patient
// discovery experience, which stays light regardless of the global theme.
const EXPERIENCE_OPTIONS = [
  { value: "0", label: "Any experience" },
  { value: "1", label: "1+ years" },
  { value: "3", label: "3+ years" },
  { value: "5", label: "5+ years" },
  { value: "10", label: "10+ years" },
];

const FEE_OPTIONS = [
  { value: "0", label: "Any fee" },
  { value: "300", label: "Under ₹300" },
  { value: "600", label: "Under ₹600" },
  { value: "1000", label: "Under ₹1000" },
];

const selectCls =
  "w-full px-3 py-2 text-sm text-gray-900 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors";

function DoctorFiltersSidebar({
  specializations,
  filters,
  onChange,
  onClear,
  hasActiveFilters,
  resultCount,
}) {
  return (
    <aside className="lg:w-72 shrink-0">
      <div className="bg-white border border-gray-200 rounded-2xl p-5 lg:sticky lg:top-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Filters</h2>
          {hasActiveFilters && (
            <button onClick={onClear} className="text-xs font-medium text-primary-700 hover:text-primary-800">
              Clear all
            </button>
          )}
        </div>

        <p className="text-xs text-gray-500 mb-5">
          {resultCount} doctor{resultCount === 1 ? "" : "s"} found
        </p>

        <div className="space-y-5">
          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Specialization
            </label>
            <select
              value={filters.specialization}
              onChange={(e) => onChange({ specialization: e.target.value })}
              className={selectCls}
            >
              <option value="all">All Specializations</option>
              {specializations.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Experience
            </label>
            <select
              value={filters.minExperience}
              onChange={(e) => onChange({ minExperience: e.target.value })}
              className={selectCls}
            >
              {EXPERIENCE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Consultation Fee
            </label>
            <select
              value={filters.maxFee}
              onChange={(e) => onChange({ maxFee: e.target.value })}
              className={selectCls}
            >
              {FEE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2">
              Availability
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={filters.availableOnly}
                onChange={(e) => onChange({ availableOnly: e.target.checked })}
                className="w-4 h-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
              <span className="text-sm text-gray-700">Available now only</span>
            </label>
          </div>
        </div>
      </div>
    </aside>
  );
}

export default DoctorFiltersSidebar;
