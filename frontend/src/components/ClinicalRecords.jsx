import { useCallback, useEffect, useState } from 'react';
import { Pill, Flask, ClockCounterClockwise, Plus, X } from '@phosphor-icons/react';
import { clinicalAPI } from '../services/api';
import { useToast } from '../context/ToastContext';

const CARD =
  'bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

const LABEL =
  'block text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wide mb-1.5';

const FIELD =
  'w-full px-3 py-2.5 text-sm rounded-xl bg-white dark:bg-surface text-slate-900 dark:text-white border border-slate-200 dark:border-surface-border outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 transition duration-150 disabled:opacity-50';

const BTN =
  'inline-flex items-center justify-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none';

const GHOST_BTN =
  'inline-flex items-center justify-center h-11 px-5 rounded-full border border-slate-200 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-surface transition duration-150 disabled:opacity-50';


// services/api.js has a response interceptor that rejects with a PLAIN Error
// carrying the server's message, so `err.response` is always undefined on
// anything routed through it. Reading err.response?.data?.message here meant
// every server message was silently replaced by the generic fallback - the
// duplicate-order 409 ("that test has already been ordered for this visit")
// arrived as "Could not order the test", which tells the doctor nothing about
// why. Both shapes are handled so this stays correct if the interceptor goes.
const apiMessage = (err, fallback) =>
  err?.response?.data?.message || err?.message || fallback;

const emptyMedicine = () => ({
  name: '',
  dosage: '',
  frequency: '',
  durationDays: '',
  instructions: '',
});

const emptyValue = () => ({
  parameter: '',
  value: '',
  unit: '',
  referenceRange: '',
  flag: 'Normal',
});

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '';

const FLAG_CLASS = {
  High: 'text-danger-600 dark:text-danger-400',
  Low: 'text-warning-600 dark:text-warning-400',
  Normal: 'text-slate-600 dark:text-slate-400',
};

const STATUS_CLASS = {
  Ordered: 'bg-slate-100 text-slate-700 dark:bg-surface dark:text-slate-300',
  'In Progress':
    'bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400',
  Completed:
    'bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-400',
  Cancelled:
    'bg-slate-100 text-slate-500 line-through dark:bg-surface dark:text-slate-500',
};

/**
 * The prescribing and test-ordering half of a consultation.
 *
 * Both write to their own collections (Prescription / LabResult) rather than
 * to the free-text Appointment.prescription string, which stays as-is for the
 * existing PDF and report flows. Previous visits are shown alongside so the
 * doctor is not prescribing against an unseen history - including the
 * free-text notes written before these collections existed, which would
 * otherwise make the history look like it began at the cutover.
 */
function ClinicalRecords({ appointmentId, readOnly = false }) {
  const toast = useToast();

  const [records, setRecords] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showHistory, setShowHistory] = useState(false);

  const [medicines, setMedicines] = useState([emptyMedicine()]);
  const [rxNotes, setRxNotes] = useState('');
  const [issuing, setIssuing] = useState(false);

  // The catalog the doctor orders from. Loaded once - it is clinic-wide
  // configuration, not per-visit data.
  const [catalog, setCatalog] = useState([]);
  const [selectedTestId, setSelectedTestId] = useState('');
  const [orderNote, setOrderNote] = useState('');
  const [ordering, setOrdering] = useState(false);

  // Which lab order is having its values typed in, and the rows so far.
  const [resultingId, setResultingId] = useState(null);
  const [resultValues, setResultValues] = useState([]);
  const [resultSummary, setResultSummary] = useState('');
  const [savingResult, setSavingResult] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await clinicalAPI.getRecords(appointmentId);
      setRecords(data);
    } catch {
      // A failure here must not take the consultation screen down with it -
      // the diagnosis form above is the critical path and stays usable.
      setRecords(null);
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (readOnly) return;

    // A catalog that fails to load leaves the ordering control disabled with
    // an explanation, rather than falling back to a free-text box - typing a
    // name is the exact thing the catalog exists to stop.
    clinicalAPI
      .getOrderableTests()
      .then(({ data }) => setCatalog(data.labTests || []))
      .catch(() => setCatalog([]));
  }, [readOnly]);

  const setMedicine = (index, field, value) =>
    setMedicines((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );

  const issuePrescription = async () => {
    // Blank trailing rows are normal - the form starts with one and the
    // doctor may add more than they fill - so they are dropped, not rejected.
    const filled = medicines.filter((m) => m.name.trim());

    if (filled.length === 0) {
      toast.error('Add at least one medicine.');
      return;
    }

    const incomplete = filled.find(
      (m) => !m.dosage.trim() || !m.frequency.trim() || !m.durationDays
    );

    if (incomplete) {
      toast.error(
        'Dosage, frequency and duration are required for ' + incomplete.name + '.'
      );
      return;
    }

    setIssuing(true);

    try {
      await clinicalAPI.issuePrescription(
        appointmentId,
        filled.map((m) => ({ ...m, durationDays: Number(m.durationDays) })),
        rxNotes
      );
      toast.success('Prescription issued.');
      setMedicines([emptyMedicine()]);
      setRxNotes('');
      await load();
    } catch (err) {
      toast.error(
        apiMessage(err, 'Could not issue the prescription.')
      );
    } finally {
      setIssuing(false);
    }
  };

  const orderTest = async () => {
    if (!selectedTestId) {
      toast.error('Select a test to order.');
      return;
    }

    const chosen = catalog.find((t) => t._id === selectedTestId);

    setOrdering(true);

    try {
      // Only the id goes to the server. The parameters shown beside the
      // picker are the LabTest's own - the doctor orders the test, and the
      // definition decides what will be measured.
      await clinicalAPI.orderLabTest(appointmentId, selectedTestId, orderNote);
      toast.success((chosen?.name || 'Test') + ' ordered.');
      setSelectedTestId('');
      setOrderNote('');
      await load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not order the test.'));
    } finally {
      setOrdering(false);
    }
  };

  const withdrawOrder = async (labOrder) => {
    try {
      await clinicalAPI.cancelLabOrder(labOrder._id);
      toast.success((labOrder.labTestId?.name || 'Order') + ' withdrawn.');
      await load();
    } catch (err) {
      toast.error(
        apiMessage(err, 'Could not withdraw the order.')
      );
    }
  };

  const openResultEntry = (lab) => {
    setResultingId(lab._id);
    setResultValues(
      lab.values?.length ? lab.values.map((v) => ({ ...v })) : [emptyValue()]
    );
    setResultSummary(lab.summary || '');
  };

  const setResultValue = (index, field, value) =>
    setResultValues((prev) =>
      prev.map((v, i) => (i === index ? { ...v, [field]: value } : v))
    );

  const saveResult = async (status) => {
    const filled = resultValues.filter(
      (v) => v.parameter.trim() && String(v.value).trim()
    );

    // The backend enforces this too - a Completed result with no values would
    // show the patient a finished test with nothing in it.
    if (status === 'Completed' && filled.length === 0) {
      toast.error('A completed test needs at least one value.');
      return;
    }

    setSavingResult(true);

    try {
      await clinicalAPI.updateLabResult(resultingId, {
        status,
        values: filled,
        summary: resultSummary,
      });
      toast.success(
        status === 'Completed' ? 'Result recorded.' : 'Progress saved.'
      );
      setResultingId(null);
      await load();
    } catch (err) {
      toast.error(apiMessage(err, 'Could not save the result.'));
    } finally {
      setSavingResult(false);
    }
  };

  if (loading) {
    return (
      <div className={CARD + ' p-6'}>
        <div className="h-5 w-40 rounded bg-slate-100 dark:bg-surface animate-pulse" />
      </div>
    );
  }

  if (!records) {
    return (
      <div className={CARD + ' p-6'}>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Prescriptions and lab orders could not be loaded.{' '}
          <button
            onClick={load}
            className="font-semibold text-primary-600 dark:text-primary-400 hover:underline"
          >
            Retry
          </button>
        </p>
      </div>
    );
  }

  const { current, history } = records;

  // A LabResult carrying a labOrderId was reported by the LABORATORY against a
  // catalog order; one without is a legacy free-text order the doctor entered
  // themselves. They are rendered differently because they are different
  // records - flattening them would offer an "Enter result" button on a
  // reading the lab has already signed off, which the backend now refuses
  // anyway (see doctorController.updateLabResult).
  const legacyResults = current.labResults.filter((lab) => !lab.labOrderId);

  const reportedByOrder = new Map(
    current.labResults
      .filter((lab) => lab.labOrderId)
      .map((lab) => [String(lab.labOrderId), lab])
  );
  const historyCount =
    history.prescriptions.length +
    history.labResults.length +
    history.legacyNotes.length;

  return (
    <div className="space-y-6">
      {/* ---------- PRESCRIPTION ---------- */}
      <section className={CARD + ' p-6'}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
            <Pill weight="duotone" className="w-5 h-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Prescription
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              The patient sees each medicine as its own line, with dosage and
              duration.
            </p>
          </div>
        </div>

        {current.prescriptions.length > 0 && (
          <ul className="mb-5 space-y-3">
            {current.prescriptions.map((rx) => (
              <li
                key={rx._id}
                className="rounded-xl border border-slate-200 dark:border-surface-border p-4"
              >
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                  Issued {fmtDate(rx.issuedAt)}
                </p>
                <ul className="space-y-1.5">
                  {rx.medicines.map((m, i) => (
                    <li
                      key={i}
                      className="text-sm text-slate-800 dark:text-slate-200"
                    >
                      <span className="font-semibold">{m.name}</span>
                      {' — '}
                      {m.dosage}, {m.frequency}, {m.durationDays} day
                      {m.durationDays === 1 ? '' : 's'}
                      {m.instructions ? ' (' + m.instructions + ')' : ''}
                    </li>
                  ))}
                </ul>
                {rx.notes && (
                  <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                    {rx.notes}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <>
            <div className="space-y-3">
              {medicines.map((m, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-end"
                >
                  <div className="sm:col-span-4">
                    {i === 0 && <label className={LABEL}>Medicine</label>}
                    <input
                      value={m.name}
                      onChange={(e) => setMedicine(i, 'name', e.target.value)}
                      placeholder="Amoxicillin"
                      aria-label="Medicine name"
                      className={FIELD}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    {i === 0 && <label className={LABEL}>Dosage</label>}
                    <input
                      value={m.dosage}
                      onChange={(e) => setMedicine(i, 'dosage', e.target.value)}
                      placeholder="500 mg"
                      aria-label="Dosage"
                      className={FIELD}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    {i === 0 && <label className={LABEL}>Frequency</label>}
                    <input
                      value={m.frequency}
                      onChange={(e) =>
                        setMedicine(i, 'frequency', e.target.value)
                      }
                      placeholder="Twice a day"
                      aria-label="Frequency"
                      className={FIELD}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    {i === 0 && <label className={LABEL}>Days</label>}
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={m.durationDays}
                      onChange={(e) =>
                        setMedicine(i, 'durationDays', e.target.value)
                      }
                      placeholder="5"
                      aria-label="Duration in days"
                      className={FIELD}
                    />
                  </div>
                  <div className="sm:col-span-2 flex gap-2">
                    <input
                      value={m.instructions}
                      onChange={(e) =>
                        setMedicine(i, 'instructions', e.target.value)
                      }
                      placeholder="After food"
                      aria-label="Instructions"
                      className={FIELD}
                    />
                    {medicines.length > 1 && (
                      <button
                        onClick={() =>
                          setMedicines((prev) => prev.filter((_, x) => x !== i))
                        }
                        aria-label={'Remove medicine ' + (i + 1)}
                        className="shrink-0 w-11 h-11 rounded-xl border border-slate-200 dark:border-surface-border text-slate-500 hover:bg-slate-50 dark:hover:bg-surface transition"
                      >
                        <X className="w-4 h-4 mx-auto" aria-hidden />
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={() => setMedicines((prev) => [...prev, emptyMedicine()])}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline"
            >
              <Plus className="w-4 h-4" aria-hidden />
              Add medicine
            </button>

            <div className="mt-4">
              <label htmlFor="rxNotes" className={LABEL}>
                Notes for the patient
              </label>
              <textarea
                id="rxNotes"
                rows={2}
                value={rxNotes}
                onChange={(e) => setRxNotes(e.target.value)}
                placeholder="Complete the full course even if symptoms improve."
                className={FIELD}
              />
            </div>

            <button
              onClick={issuePrescription}
              disabled={issuing}
              className={BTN + ' mt-4'}
            >
              {issuing ? 'Issuing…' : 'Issue prescription'}
            </button>
          </>
        )}
      </section>

      {/* ---------- LAB ORDERS ---------- */}
      <section className={CARD + ' p-6'}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-10 h-10 rounded-xl bg-success-50 text-success-600 dark:bg-success-500/10 flex items-center justify-center shrink-0">
            <Flask weight="duotone" className="w-5 h-5" aria-hidden />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
              Lab tests
            </h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Order a test from the catalog; the lab records its values.
            </p>
          </div>
        </div>

        {/* Catalog-based orders. What the doctor places from now on. */}
        {current.labOrders?.length > 0 && (
          <ul className="mb-5 space-y-3">
            {current.labOrders.map((order) => (
              <li
                key={order._id}
                className="rounded-xl border border-slate-200 dark:border-surface-border p-4"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {order.labTestId?.name || 'Test no longer in the catalog'}
                      {order.labTestId?.shortName
                        ? ' (' + order.labTestId.shortName + ')'
                        : ''}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Ordered {fmtDate(order.orderedAt)}
                      {order.doctorId?.name ? ' · ' + order.doctorId.name : ''}
                    </p>
                    {order.note && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        {order.note}
                      </p>
                    )}
                    {/* What the lab will measure. Read-only here: these come
                        from the LabTest definition, and the doctor orders the
                        test rather than choosing its parameters. */}
                    {order.labTestId?.parameters?.length > 0 && (
                      <p className="text-xs text-slate-400 mt-1">
                        {order.labTestId.parameters
                          .map((param) => param.name)
                          .join(' · ')}
                      </p>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={
                        'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ' +
                        STATUS_CLASS[order.status]
                      }
                    >
                      {order.status}
                    </span>

                    {!readOnly &&
                      order.status !== 'Completed' &&
                      order.status !== 'Cancelled' && (
                        <button
                          onClick={() => withdrawOrder(order)}
                          className="text-xs font-semibold text-slate-500 hover:text-danger-600 hover:underline"
                        >
                          Withdraw
                        </button>
                      )}
                  </div>
                </div>

                {/* What the laboratory reported. Read-only: these values,
                    units and reference ranges are the lab's record, and the
                    backend refuses an edit from a doctor token. */}
                {reportedByOrder.get(String(order._id))?.status ===
                  'Completed' && (
                  <div className="mt-3 pt-3 border-t border-slate-200 dark:border-surface-border">
                    <ul className="space-y-1.5">
                      {reportedByOrder
                        .get(String(order._id))
                        .values.map((v) => (
                          <li
                            key={v.parameter}
                            className="flex flex-wrap items-baseline gap-x-2 text-sm"
                          >
                            <span className="text-slate-600 dark:text-slate-300">
                              {v.parameter}:
                            </span>
                            <span
                              className={
                                'font-semibold ' + (FLAG_CLASS[v.flag] || '')
                              }
                            >
                              {v.value}
                              {v.unit ? ' ' + v.unit : ''}
                            </span>
                            {v.referenceRange && (
                              <span className="text-xs text-slate-400">
                                (ref {v.referenceRange})
                              </span>
                            )}
                            {v.flag && v.flag !== 'Normal' && (
                              <span
                                className={
                                  'text-xs font-semibold ' +
                                  (FLAG_CLASS[v.flag] || '')
                                }
                              >
                                {v.flag}
                              </span>
                            )}
                          </li>
                        ))}
                    </ul>

                    {reportedByOrder.get(String(order._id)).summary && (
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                        {reportedByOrder.get(String(order._id)).summary}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* Legacy free-text orders, kept so earlier visits still read
            correctly and their results can still be filled in. Nothing new
            is created here - see the picker at the bottom of this card. */}
        {legacyResults.length > 0 && (
          <ul className="mb-5 space-y-3">
            {legacyResults.map((lab) => (
              <li
                key={lab._id}
                className="rounded-xl border border-slate-200 dark:border-surface-border p-4"
              >
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {lab.testName}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      Ordered {fmtDate(lab.orderedAt)}
                      {lab.resultedAt
                        ? ' · reported ' + fmtDate(lab.resultedAt)
                        : ''}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span
                      className={
                        'inline-flex items-center px-2.5 py-1 rounded-full text-[12.5px] font-semibold ' +
                        STATUS_CLASS[lab.status]
                      }
                    >
                      {lab.status}
                    </span>
                    {!readOnly && resultingId !== lab._id && (
                      <button
                        onClick={() => openResultEntry(lab)}
                        className="text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                      >
                        {lab.status === 'Completed'
                          ? 'Edit result'
                          : 'Enter result'}
                      </button>
                    )}
                  </div>
                </div>

                {lab.values?.length > 0 && resultingId !== lab._id && (
                  <ul className="mt-3 space-y-1">
                    {lab.values.map((v, i) => (
                      <li key={i} className="text-sm">
                        <span className="text-slate-700 dark:text-slate-300">
                          {v.parameter}:{' '}
                        </span>
                        <span
                          className={'font-semibold ' + FLAG_CLASS[v.flag]}
                        >
                          {v.value} {v.unit}
                        </span>
                        {v.referenceRange && (
                          <span className="text-xs text-slate-400">
                            {' (ref ' + v.referenceRange + ')'}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}

                {resultingId === lab._id && (
                  <div className="mt-4 space-y-2">
                    {resultValues.map((v, i) => (
                      <div
                        key={i}
                        className="grid grid-cols-1 sm:grid-cols-12 gap-2"
                      >
                        <input
                          value={v.parameter}
                          onChange={(e) =>
                            setResultValue(i, 'parameter', e.target.value)
                          }
                          placeholder="Haemoglobin"
                          aria-label="Parameter"
                          className={FIELD + ' sm:col-span-4'}
                        />
                        <input
                          value={v.value}
                          onChange={(e) =>
                            setResultValue(i, 'value', e.target.value)
                          }
                          placeholder="11.2"
                          aria-label="Value"
                          className={FIELD + ' sm:col-span-2'}
                        />
                        <input
                          value={v.unit}
                          onChange={(e) =>
                            setResultValue(i, 'unit', e.target.value)
                          }
                          placeholder="g/dL"
                          aria-label="Unit"
                          className={FIELD + ' sm:col-span-2'}
                        />
                        <input
                          value={v.referenceRange}
                          onChange={(e) =>
                            setResultValue(i, 'referenceRange', e.target.value)
                          }
                          placeholder="13.0 - 17.0"
                          aria-label="Reference range"
                          className={FIELD + ' sm:col-span-2'}
                        />
                        <select
                          value={v.flag}
                          onChange={(e) =>
                            setResultValue(i, 'flag', e.target.value)
                          }
                          aria-label="Flag"
                          className={FIELD + ' sm:col-span-2'}
                        >
                          <option value="Normal">Normal</option>
                          <option value="High">High</option>
                          <option value="Low">Low</option>
                        </select>
                      </div>
                    ))}

                    <button
                      onClick={() =>
                        setResultValues((prev) => [...prev, emptyValue()])
                      }
                      className="inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 dark:text-primary-400 hover:underline"
                    >
                      <Plus className="w-4 h-4" aria-hidden />
                      Add parameter
                    </button>

                    <textarea
                      rows={2}
                      value={resultSummary}
                      onChange={(e) => setResultSummary(e.target.value)}
                      placeholder="Summary for the patient (optional)"
                      aria-label="Result summary"
                      className={FIELD}
                    />

                    <div className="flex flex-wrap gap-2 pt-1">
                      <button
                        onClick={() => saveResult('Completed')}
                        disabled={savingResult}
                        className={BTN}
                      >
                        {savingResult ? 'Saving…' : 'Save as completed'}
                      </button>
                      <button
                        onClick={() => saveResult('In Progress')}
                        disabled={savingResult}
                        className={GHOST_BTN}
                      >
                        Save progress
                      </button>
                      <button
                        onClick={() => setResultingId(null)}
                        className="inline-flex items-center justify-center h-11 px-5 rounded-full text-sm font-semibold text-slate-500 hover:bg-slate-50 dark:hover:bg-surface transition"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {!readOnly && (
          <div className="space-y-3">
            {catalog.length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                The lab test catalog could not be loaded, or no tests are
                active. An administrator manages it under Lab Tests.
              </p>
            ) : (
              <>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={selectedTestId}
                    onChange={(e) => setSelectedTestId(e.target.value)}
                    aria-label="Lab test"
                    className={FIELD}
                  >
                    <option value="">Select a test…</option>
                    {catalog.map((labTest) => (
                      <option key={labTest._id} value={labTest._id}>
                        {labTest.name}
                        {labTest.shortName ? ' (' + labTest.shortName + ')' : ''}
                      </option>
                    ))}
                  </select>

                  <button
                    onClick={orderTest}
                    disabled={ordering || !selectedTestId}
                    className={BTN}
                  >
                    {ordering ? 'Ordering…' : 'Order Lab Test'}
                  </button>
                </div>

                <input
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  placeholder="Note for the lab (optional) — e.g. fasting sample"
                  aria-label="Note for the lab"
                  className={FIELD}
                />

                {/* Shown before ordering so the doctor can see what the panel
                    covers. Not editable: parameters belong to the LabTest. */}
                {selectedTestId && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Measures:{' '}
                    {catalog
                      .find((t) => t._id === selectedTestId)
                      ?.parameters?.map((param) => param.name)
                      .join(' · ') || 'no parameters defined'}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {/* ---------- PREVIOUS VISITS ---------- */}
      {historyCount > 0 && (
        <section className={CARD + ' p-6'}>
          <button
            onClick={() => setShowHistory((v) => !v)}
            aria-expanded={showHistory}
            className="flex items-center gap-3 w-full text-left"
          >
            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 dark:bg-surface dark:text-slate-300 flex items-center justify-center shrink-0">
              <ClockCounterClockwise
                weight="duotone"
                className="w-5 h-5"
                aria-hidden
              />
            </div>
            <div className="flex-1">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                Previous visits
              </h2>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                {historyCount} earlier record{historyCount === 1 ? '' : 's'} for
                this patient
              </p>
            </div>
            <span className="text-sm font-semibold text-primary-600 dark:text-primary-400">
              {showHistory ? 'Hide' : 'Show'}
            </span>
          </button>

          {showHistory && (
            <div className="mt-5 space-y-5">
              {history.prescriptions.length > 0 && (
                <div>
                  <h3 className={LABEL}>Earlier prescriptions</h3>
                  <ul className="space-y-3">
                    {history.prescriptions.map((rx) => (
                      <li
                        key={rx._id}
                        className="rounded-xl border border-slate-200 dark:border-surface-border p-4"
                      >
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                          {fmtDate(rx.issuedAt)}
                          {rx.doctorId?.name
                            ? ' · Dr. ' + rx.doctorId.name
                            : ''}
                        </p>
                        <ul className="space-y-1">
                          {rx.medicines.map((m, i) => (
                            <li
                              key={i}
                              className="text-sm text-slate-700 dark:text-slate-300"
                            >
                              <span className="font-semibold">{m.name}</span>
                              {' — '}
                              {m.dosage}, {m.frequency}, {m.durationDays}d
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {history.labResults.length > 0 && (
                <div>
                  <h3 className={LABEL}>Earlier lab tests</h3>
                  <ul className="space-y-2">
                    {history.labResults.map((lab) => (
                      <li
                        key={lab._id}
                        className="rounded-xl border border-slate-200 dark:border-surface-border p-4"
                      >
                        <div className="flex items-center justify-between gap-3 flex-wrap">
                          <p className="text-sm font-semibold text-slate-900 dark:text-white">
                            {lab.testName}
                          </p>
                          <span className="text-xs text-slate-500 dark:text-slate-400">
                            {fmtDate(lab.resultedAt || lab.orderedAt)}
                          </span>
                        </div>
                        {lab.values?.length > 0 && (
                          <ul className="mt-2 space-y-1">
                            {lab.values.map((v, i) => (
                              <li key={i} className="text-sm">
                                <span className="text-slate-700 dark:text-slate-300">
                                  {v.parameter}:{' '}
                                </span>
                                <span
                                  className={
                                    'font-semibold ' + FLAG_CLASS[v.flag]
                                  }
                                >
                                  {v.value} {v.unit}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {history.legacyNotes.length > 0 && (
                <div>
                  <h3 className={LABEL}>Earlier consultation notes</h3>
                  <ul className="space-y-2">
                    {history.legacyNotes.map((note) => (
                      <li
                        key={note._id}
                        className="rounded-xl border border-slate-200 dark:border-surface-border p-4"
                      >
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-1">
                          {fmtDate(note.appointmentDate)} {'·'}{' '}
                          {note.bookingId}
                        </p>
                        {note.diagnosis && (
                          <p className="text-sm text-slate-700 dark:text-slate-300">
                            <span className="font-semibold">Diagnosis:</span>{' '}
                            {note.diagnosis}
                          </p>
                        )}
                        <p className="text-sm text-slate-700 dark:text-slate-300">
                          <span className="font-semibold">Prescribed:</span>{' '}
                          {note.prescription}
                        </p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

export default ClinicalRecords;
