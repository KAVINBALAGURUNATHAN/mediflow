import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Flask,
  Plus,
  Trash,
  ArrowLeft,
  ArrowCounterClockwise,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";

// The lab test catalog, for admin. This is the definition of what a test IS -
// its name and the parameters a result form should ask for. It is not a
// patient's result and holds no patient data.
//
// The catalog is the single source of truth for parameters. There is
// deliberately no CBCForm/LFTForm/ThyroidForm anywhere in this codebase: the
// result form (Phase 5) is generated from whatever is stored here, so adding a
// test is a data change made on this screen, not a code change.
//
// Access is enforced twice and neither is done here: AdminProtectedRoute gates
// the route on a valid admin token, and adminAuth rejects the request
// server-side. The API instance attaches the admin token for any /admin/ URL.

const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";
const INPUT =
  "w-full h-11 px-3.5 rounded-lg text-sm bg-white dark:bg-surface text-slate-900 dark:text-white placeholder:text-slate-400 border border-slate-300 dark:border-surface-border focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none transition duration-150";
const PILL_PRIMARY =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none";
const PILL_OUTLINE =
  "inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full border border-slate-300 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 active:scale-[0.98] transition duration-150";
const TH =
  "text-left text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 px-4 py-2.5 border-b border-slate-200 dark:border-surface-border whitespace-nowrap";
const TD = "px-4 py-3 border-b border-slate-100 dark:border-surface-border";

// Rows carry a client-only id so React can key on identity rather than array
// position. With an index key, removing a middle row shifts every key below
// it: React then reuses the wrong DOM nodes, so focus and the checkbox land on
// the row that moved up rather than the one being edited. The id is stripped
// before the row is sent - the server rebuilds parameters field by field and
// would drop it anyway, but stripping it here keeps the request honest.
let rowId = 0;
const nextRowId = () => `row-${(rowId += 1)}`;

const emptyParameter = () => ({
  _rowId: nextRowId(),
  name: "",
  unit: "",
  dataType: "number",
  required: true,
  referenceRange: "",
});

const emptyDraft = () => ({
  _id: null,
  name: "",
  shortName: "",
  category: "",
  parameters: [emptyParameter()],
});

function AdminLabTests() {
  const toast = useToast();

  const [labTests, setLabTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(null);

  const load = useCallback(async () => {
    try {
      // Retired tests are included so the admin can see and restore them.
      // Every other consumer of this endpoint gets active tests only.
      const res = await API.get("/admin/lab-tests?includeInactive=1");
      setLabTests(res.data.labTests || []);
    } catch (err) {
      toast.error(
        err.response?.data?.message || err.message || "Failed to load the catalog"
      );
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  const startCreate = () => setDraft(emptyDraft());

  const startEdit = (labTest) =>
    setDraft({
      _id: labTest._id,
      name: labTest.name,
      shortName: labTest.shortName || "",
      category: labTest.category || "",
      // Copied, not referenced - abandoning the form must leave the loaded
      // catalog untouched.
      parameters: (labTest.parameters || []).map((p) => ({
        ...p,
        _rowId: nextRowId(),
      })),
    });

  const setField = (field, value) =>
    setDraft((prev) => ({ ...prev, [field]: value }));

  const setParameter = (index, field, value) =>
    setDraft((prev) => ({
      ...prev,
      parameters: prev.parameters.map((p, i) =>
        i === index ? { ...p, [field]: value } : p
      ),
    }));

  const addParameter = () =>
    setDraft((prev) => ({
      ...prev,
      parameters: [...prev.parameters, emptyParameter()],
    }));

  const removeParameter = (index) =>
    setDraft((prev) => ({
      ...prev,
      parameters: prev.parameters.filter((_, i) => i !== index),
    }));

  const handleSave = async () => {
    setSaving(true);

    try {
      const body = {
        name: draft.name,
        shortName: draft.shortName,
        category: draft.category,
        // Blank rows are dropped server-side, so they are sent as typed
        // rather than filtered here - one place decides what counts as a
        // parameter. Only the local row key is removed.
        parameters: draft.parameters.map(({ _rowId, ...rest }) => rest),
      };

      if (draft._id) {
        await API.put(`/admin/lab-tests/${draft._id}`, body);
        toast.success("Lab test updated");
      } else {
        await API.post("/admin/lab-tests", body);
        toast.success("Lab test created");
      }

      setDraft(null);
      await load();
    } catch (err) {
      toast.error(
        err.response?.data?.message || err.message || "Failed to save the lab test"
      );
    } finally {
      setSaving(false);
    }
  };

  const handleRetire = async (labTest) => {
    try {
      await API.delete(`/admin/lab-tests/${labTest._id}`);
      toast.success(`${labTest.name} retired`);
      await load();
    } catch (err) {
      toast.error(
        err.response?.data?.message || err.message || "Failed to retire the test"
      );
    }
  };

  const handleRestore = async (labTest) => {
    try {
      await API.put(`/admin/lab-tests/${labTest._id}`, { isActive: true });
      toast.success(`${labTest.name} restored`);
      await load();
    } catch (err) {
      toast.error(
        err.response?.data?.message || err.message || "Failed to restore the test"
      );
    }
  };

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
      <Link
        to="/admin-dashboard"
        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-4"
      >
        <ArrowLeft weight="bold" className="w-3.5 h-3.5" aria-hidden="true" />
        Back to Admin Dashboard
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
            <Flask weight="duotone" className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-white tracking-tight">
              Lab Test Catalog
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Test definitions and their parameters
            </p>
          </div>
        </div>

        {!draft && (
          <button type="button" onClick={startCreate} className={PILL_PRIMARY}>
            <Plus weight="bold" className="w-4 h-4" aria-hidden="true" />
            Add Test
          </button>
        )}
      </div>

      {draft && (
        <div className={`${CARD} p-5 sm:p-6 mb-6`}>
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {draft._id ? "Edit test" : "New test"}
            </h2>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="p-1.5 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
              aria-label="Close the form"
            >
              <X weight="bold" className="w-4 h-4" />
            </button>
          </div>

          <div className="grid gap-4 sm:grid-cols-3 mb-6">
            <div>
              <label
                htmlFor="test-name"
                className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Test name
              </label>
              <input
                id="test-name"
                value={draft.name}
                onChange={(e) => setField("name", e.target.value)}
                className={INPUT}
                placeholder="Complete Blood Count"
              />
            </div>

            <div>
              <label
                htmlFor="test-short-name"
                className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Short name
              </label>
              <input
                id="test-short-name"
                value={draft.shortName}
                onChange={(e) => setField("shortName", e.target.value)}
                className={INPUT}
                placeholder="CBC"
              />
            </div>

            <div>
              <label
                htmlFor="test-category"
                className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                Category
              </label>
              <input
                id="test-category"
                value={draft.category}
                onChange={(e) => setField("category", e.target.value)}
                className={INPUT}
                placeholder="Haematology"
              />
            </div>
          </div>

          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              Parameters
            </h3>
            <button type="button" onClick={addParameter} className={PILL_OUTLINE}>
              <Plus weight="bold" className="w-4 h-4" aria-hidden="true" />
              Add Parameter
            </button>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
            These become the fields on the result-entry form. A required
            parameter must be filled in before a technician can complete the
            test.
          </p>

          <div className="space-y-3">
            {draft.parameters.map((parameter, index) => (
              <div
                key={parameter._rowId}
                className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1.5fr_auto] items-end rounded-xl border border-slate-200 dark:border-surface-border p-3"
              >
                <div>
                  <label
                    htmlFor={`param-name-${index}`}
                    className="block text-[11px] font-medium text-slate-500 mb-1"
                  >
                    Name
                  </label>
                  <input
                    id={`param-name-${index}`}
                    value={parameter.name}
                    onChange={(e) => setParameter(index, "name", e.target.value)}
                    className={INPUT}
                    placeholder="Haemoglobin"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`param-unit-${index}`}
                    className="block text-[11px] font-medium text-slate-500 mb-1"
                  >
                    Unit
                  </label>
                  <input
                    id={`param-unit-${index}`}
                    value={parameter.unit}
                    onChange={(e) => setParameter(index, "unit", e.target.value)}
                    className={INPUT}
                    placeholder="g/dL"
                  />
                </div>

                <div>
                  <label
                    htmlFor={`param-type-${index}`}
                    className="block text-[11px] font-medium text-slate-500 mb-1"
                  >
                    Type
                  </label>
                  <select
                    id={`param-type-${index}`}
                    value={parameter.dataType}
                    onChange={(e) => setParameter(index, "dataType", e.target.value)}
                    className={INPUT}
                  >
                    <option value="number">Number</option>
                    <option value="text">Text</option>
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`param-range-${index}`}
                    className="block text-[11px] font-medium text-slate-500 mb-1"
                  >
                    Reference range
                  </label>
                  <input
                    id={`param-range-${index}`}
                    value={parameter.referenceRange}
                    onChange={(e) =>
                      setParameter(index, "referenceRange", e.target.value)
                    }
                    className={INPUT}
                    placeholder="13.0 - 17.0"
                  />
                </div>

                <div className="flex items-center gap-3 pb-2.5">
                  <label className="inline-flex items-center gap-1.5 text-[11px] font-medium text-slate-500 whitespace-nowrap">
                    <input
                      type="checkbox"
                      checked={parameter.required}
                      onChange={(e) =>
                        setParameter(index, "required", e.target.checked)
                      }
                      className="w-4 h-4 rounded border-slate-300"
                    />
                    Required
                  </label>

                  <button
                    type="button"
                    onClick={() => removeParameter(index)}
                    className="p-2 text-slate-400 hover:text-danger-600"
                    aria-label={`Remove parameter ${index + 1}`}
                  >
                    <Trash weight="duotone" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-3 mt-6">
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className={PILL_PRIMARY}
            >
              {saving ? "Saving…" : draft._id ? "Save Changes" : "Create Test"}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className={PILL_OUTLINE}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className={`${CARD} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem]">
            <thead>
              <tr>
                <th className={TH}>Test</th>
                <th className={TH}>Category</th>
                <th className={TH}>Parameters</th>
                <th className={TH}>Status</th>
                <th className={TH}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td className={`${TD} text-sm text-slate-500`} colSpan={5}>
                    Loading the catalog…
                  </td>
                </tr>
              ) : labTests.length === 0 ? (
                <tr>
                  <td className={`${TD} text-sm text-slate-500`} colSpan={5}>
                    No tests defined yet. Add one, or run{" "}
                    <code>node scripts/seedLabTests.js</code> for the demo set.
                  </td>
                </tr>
              ) : (
                labTests.map((labTest) => (
                  <tr key={labTest._id} className={labTest.isActive ? "" : "opacity-60"}>
                    <td className={TD}>
                      <p className="text-sm font-semibold text-slate-900 dark:text-white">
                        {labTest.name}
                      </p>
                      {labTest.shortName && (
                        <p className="text-xs text-slate-500">{labTest.shortName}</p>
                      )}
                    </td>

                    <td className={`${TD} text-sm text-slate-600 dark:text-slate-300`}>
                      {labTest.category}
                    </td>

                    <td className={TD}>
                      <p className="text-sm text-slate-600 dark:text-slate-300">
                        {labTest.parameters?.length ?? 0}
                      </p>
                      <p className="text-xs text-slate-400 truncate max-w-[18rem]">
                        {(labTest.parameters || [])
                          .map((p) => p.name)
                          .join(", ")}
                      </p>
                    </td>

                    <td className={TD}>
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                          labTest.isActive
                            ? "bg-success-50 text-success-700"
                            : "bg-slate-100 text-slate-600"
                        }`}
                      >
                        {labTest.isActive ? "Active" : "Retired"}
                      </span>
                    </td>

                    <td className={TD}>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => startEdit(labTest)}
                          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-slate-300 dark:border-surface-border text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                        >
                          <PencilSimple weight="duotone" className="w-3.5 h-3.5" aria-hidden="true" />
                          Edit
                        </button>

                        {labTest.isActive ? (
                          <button
                            type="button"
                            onClick={() => handleRetire(labTest)}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-slate-300 dark:border-surface-border text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                            // Retire, not delete: results already reported
                            // against this test must keep their meaning.
                            title="Retire this test - existing results keep their meaning"
                          >
                            <Trash weight="duotone" className="w-3.5 h-3.5" aria-hidden="true" />
                            Retire
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleRestore(labTest)}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-full border border-slate-300 dark:border-surface-border text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5"
                          >
                            <ArrowCounterClockwise weight="duotone" className="w-3.5 h-3.5" aria-hidden="true" />
                            Restore
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400 mt-4">
        Reference ranges shipped with the demo catalog are placeholders. Replace
        them with the ranges your laboratory issues before using them
        clinically.
      </p>
    </div>
  );
}

export default AdminLabTests;
