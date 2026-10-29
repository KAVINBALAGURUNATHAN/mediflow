import { useState, useEffect, useMemo } from "react";
import PropTypes from "prop-types";
import { labTechnicianAPI } from "../services/api";
import { useToast } from "../context/ToastContext";

// THE result-entry form. Singular, deliberately.
//
// Every field on this form is generated from `labTest.parameters` - the
// catalog definition the order points at. CBC renders Haemoglobin / WBC /
// Platelets / RBC / Haematocrit; Thyroid Profile renders TSH / T3 / T4; and
// both come through this one component with no branch on which test it is.
//
// There is deliberately no CBCForm.jsx, LFTForm.jsx or ThyroidForm.jsx in this
// codebase and there must not be. Adding a test to the catalog is a data
// change an admin makes on the Lab Tests screen; it must never require a new
// component here. If you find yourself writing `if (testName === ...)`, the
// missing information belongs in LabTest.parameters instead.
//
// The server rebuilds the submitted values against the same definition, so
// this form cannot invent a parameter, rename one or change a unit - what is
// rendered here is a convenience, not the source of truth.

const FIELD =
  "w-full h-11 px-3.5 rounded-lg text-sm bg-white dark:bg-surface text-slate-900 dark:text-white placeholder:text-slate-400 border border-slate-300 dark:border-surface-border focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none transition duration-150";
const BTN =
  "inline-flex items-center justify-center h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none";
const GHOST_BTN =
  "inline-flex items-center justify-center h-11 px-5 rounded-full border border-slate-300 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition duration-150 disabled:opacity-50 disabled:pointer-events-none";

const FLAGS = ["Normal", "High", "Low"];

function LabResultForm({ labOrderId, onSaved, onCancel }) {
  const toast = useToast();

  const [form, setForm] = useState(null);
  const [values, setValues] = useState({});
  const [flags, setFlags] = useState({});
  const [summary, setSummary] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    labTechnicianAPI
      .getResultForm(labOrderId)
      .then(({ data }) => {
        if (cancelled) return;

        setForm(data);

        // A draft may already exist. Its saved values are keyed back by
        // parameter name so the technician resumes where they left off.
        const saved = {};
        const savedFlags = {};

        for (const value of data.labResult?.values || []) {
          saved[value.parameter] = value.value;
          savedFlags[value.parameter] = value.flag || "Normal";
        }

        setValues(saved);
        setFlags(savedFlags);
        setSummary(data.labResult?.summary || "");
      })
      .catch((err) => {
        if (!cancelled) toast.error(err.message || "Could not open the form");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [labOrderId, toast]);

  const parameters = useMemo(() => form?.labTest?.parameters || [], [form]);

  // Mirrors the server's rule so a required field is flagged before a round
  // trip. The server still enforces it - this is only the faster message.
  const missingRequired = useMemo(
    () =>
      parameters
        .filter((p) => p.required && !String(values[p.name] ?? "").trim())
        .map((p) => p.name),
    [parameters, values]
  );

  const save = async (complete) => {
    setSaving(true);

    try {
      const { data } = await labTechnicianAPI.saveResult(labOrderId, {
        values,
        flags,
        summary,
        complete,
      });

      toast.success(data.message || (complete ? "Result completed" : "Draft saved"));
      if (onSaved) await onSaved();
    } catch (err) {
      toast.error(err.message || "Could not save the result");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
        Opening the result form…
      </p>
    );
  }

  if (!form) {
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400 py-4">
        This result form could not be loaded.
      </p>
    );
  }

  const isCompleted = form.labResult?.status === "Completed";

  return (
    <div className="rounded-xl border border-slate-200 dark:border-surface-border p-4 sm:p-5 bg-slate-50/60 dark:bg-surface">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-4">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-white">
            {form.labTest.name}
            {form.labTest.shortName ? ` (${form.labTest.shortName})` : ""}
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {parameters.length} parameter{parameters.length === 1 ? "" : "s"}{" "}
            from the catalog definition
          </p>
        </div>

        {form.labOrder.note && (
          <p className="text-xs text-warning-700 dark:text-warning-400">
            {form.labOrder.note}
          </p>
        )}
      </div>

      <div className="space-y-3">
        {parameters.map((parameter) => (
          <div
            key={parameter.name}
            className="grid gap-3 sm:grid-cols-[1.6fr_1fr_1fr] items-end"
          >
            <div>
              <label
                htmlFor={`value-${parameter.name}`}
                className="block text-[13px] font-medium text-slate-700 dark:text-slate-300 mb-1.5"
              >
                {parameter.name}
                {parameter.unit && (
                  <span className="text-slate-400 font-normal">
                    {" "}
                    ({parameter.unit})
                  </span>
                )}
                {parameter.required && (
                  <span className="text-danger-600" aria-hidden="true">
                    {" "}
                    *
                  </span>
                )}
              </label>

              <input
                id={`value-${parameter.name}`}
                // The definition decides the input type. Text parameters exist
                // because real reports carry "Negative" and "<0.01".
                type={parameter.dataType === "number" ? "number" : "text"}
                inputMode={parameter.dataType === "number" ? "decimal" : "text"}
                step="any"
                aria-label={parameter.name}
                aria-required={parameter.required}
                value={values[parameter.name] ?? ""}
                onChange={(e) =>
                  setValues((prev) => ({
                    ...prev,
                    [parameter.name]: e.target.value,
                  }))
                }
                disabled={isCompleted}
                className={FIELD}
              />
            </div>

            <div>
              <p className="block text-[11px] font-medium text-slate-500 mb-1.5">
                Reference range
              </p>
              {/* Read-only: it comes from the definition and is copied onto
                  the result at save time, so a later catalog revision cannot
                  change what an old report was read against. */}
              <div className="h-11 px-3 flex items-center rounded-lg border border-dashed border-slate-300 dark:border-surface-border text-sm text-slate-600 dark:text-slate-300">
                {parameter.referenceRange || "—"}
              </div>
            </div>

            <div>
              <label
                htmlFor={`flag-${parameter.name}`}
                className="block text-[11px] font-medium text-slate-500 mb-1.5"
              >
                Flag
              </label>
              <select
                id={`flag-${parameter.name}`}
                aria-label={`${parameter.name} flag`}
                value={flags[parameter.name] || "Normal"}
                onChange={(e) =>
                  setFlags((prev) => ({
                    ...prev,
                    [parameter.name]: e.target.value,
                  }))
                }
                disabled={isCompleted}
                className={FIELD}
              >
                {FLAGS.map((flag) => (
                  <option key={flag} value={flag}>
                    {flag}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>

      <textarea
        rows={2}
        value={summary}
        onChange={(e) => setSummary(e.target.value)}
        placeholder="Summary for the doctor (optional)"
        aria-label="Result summary"
        disabled={isCompleted}
        className={`${FIELD} h-auto py-2.5 mt-4`}
      />

      {isCompleted ? (
        <p className="text-sm text-success-700 dark:text-success-400 mt-4 font-semibold">
          This result has been reported and can no longer be edited.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2 mt-5">
            <button
              type="button"
              onClick={() => save(true)}
              disabled={saving}
              className={BTN}
            >
              {saving ? "Saving…" : "Complete Result"}
            </button>

            {/* A draft is allowed to be as incomplete as the bench actually
                is - only completion applies the required-parameter rule. */}
            <button
              type="button"
              onClick={() => save(false)}
              disabled={saving}
              className={GHOST_BTN}
            >
              Save Draft
            </button>

            <button
              type="button"
              onClick={onCancel}
              className="inline-flex items-center justify-center h-11 px-5 rounded-full text-sm font-semibold text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 transition"
            >
              Close
            </button>
          </div>

          {missingRequired.length > 0 && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
              Still required to complete: {missingRequired.join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

LabResultForm.propTypes = {
  labOrderId: PropTypes.string.isRequired,
  onSaved: PropTypes.func,
  onCancel: PropTypes.func,
};

export default LabResultForm;
