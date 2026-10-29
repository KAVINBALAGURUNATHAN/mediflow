import { useState, useEffect, useCallback } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Flask, ArrowClockwise, Play } from "@phosphor-icons/react";
import { labTechnicianAPI } from "../services/api";
import { useToast } from "../context/ToastContext";
import LoadingSpinner from "../components/LoadingSpinner";
import LabResultForm from "../components/LabResultForm";

const EASE = [0.16, 1, 0.3, 1];

const TH =
  "text-left text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 px-4 py-2.5 border-b border-slate-200 dark:border-surface-border whitespace-nowrap";
const TD = "px-4 py-3.5 border-b border-slate-100 dark:border-surface-border";
const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const STATUS_CLASS = {
  Ordered: "bg-slate-100 text-slate-700 dark:bg-surface dark:text-slate-300",
  "In Progress":
    "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-400",
};

const fmtDate = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";

// The laboratory worklist: tests doctors have ordered, waiting to be run.
//
// Read-mostly by design. This phase can move an order from Ordered to
// In Progress and nothing else - recording the values is Phase 5, on a form
// generated from the LabTest definition rather than typed by hand.
function LabTechnicianDashboard() {
  const toast = useToast();
  const reduceMotion = useReducedMotion();

  const [worklist, setWorklist] = useState({ pending: [], inProgress: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [starting, setStarting] = useState(null);
  // Which order has its result form open. One at a time: two open forms on
  // one bench is a way to type a reading into the wrong patient.
  const [enteringId, setEnteringId] = useState(null);

  const load = useCallback(
    async ({ quiet = false } = {}) => {
      if (quiet) setRefreshing(true);
      try {
        const res = await labTechnicianAPI.getWorklist();
        setWorklist({
          pending: res.data.pending || [],
          inProgress: res.data.inProgress || [],
        });
      } catch (err) {
        toast.error(err.message || "Failed to load the worklist");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    load();
  }, [load]);

  const handleStart = async (order) => {
    setStarting(order._id);
    try {
      const res = await labTechnicianAPI.startTest(order._id);
      toast.success(res.data.message || "Test started");
      await load({ quiet: true });
    } catch (err) {
      toast.error(err.message || "Could not start the test");
      // Reload anyway: the usual reason a start fails is that the order
      // moved on underneath us (withdrawn, or already picked up by a
      // colleague), and the list should show that rather than stay stale.
      await load({ quiet: true });
    } finally {
      setStarting(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <LoadingSpinner />
      </div>
    );
  }

  const renderTable = (orders, { started }) => (
    <div className={`${CARD} overflow-hidden`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem]">
          <thead>
            <tr>
              <th className={TH}>Patient</th>
              <th className={TH}>Test</th>
              <th className={TH}>Doctor</th>
              <th className={TH}>Ordered</th>
              <th className={TH}>Status</th>
              <th className={TH}>Action</th>
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 ? (
              <tr>
                <td className={`${TD} text-sm text-slate-500`} colSpan={6}>
                  {started
                    ? "Nothing is on the bench."
                    : "No tests are waiting. Orders appear here as doctors place them."}
                </td>
              </tr>
            ) : (
              orders.map((order) => (
                <motion.tr
                  key={order._id}
                  initial={reduceMotion ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.2, ease: EASE }}
                >
                  <td className={TD}>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {order.patientId?.name || "Unknown patient"}
                    </p>
                    {order.appointmentId?.bookingId && (
                      <p className="text-xs text-slate-500">
                        {order.appointmentId.bookingId}
                        {order.appointmentId.slot
                          ? ` · ${order.appointmentId.slot}`
                          : ""}
                      </p>
                    )}
                  </td>

                  <td className={TD}>
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {order.labTestId?.name || "Test no longer in the catalog"}
                    </p>
                    {/* What this panel measures, straight from the LabTest
                        definition - the technician does not type these. */}
                    {order.labTestId?.parameters?.length > 0 && (
                      <p className="text-xs text-slate-400 truncate max-w-[20rem]">
                        {order.labTestId.parameters
                          .map((param) => param.name)
                          .join(" · ")}
                      </p>
                    )}
                    {order.note && (
                      <p className="text-xs text-warning-700 dark:text-warning-400 mt-0.5">
                        {order.note}
                      </p>
                    )}
                  </td>

                  <td className={`${TD} text-sm text-slate-600 dark:text-slate-300`}>
                    {order.doctorId?.name || "—"}
                  </td>

                  <td className={`${TD} text-xs text-slate-500 whitespace-nowrap`}>
                    {fmtDate(order.orderedAt)}
                  </td>

                  <td className={TD}>
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                        STATUS_CLASS[order.status] || ""
                      }`}
                    >
                      {order.status}
                    </span>
                  </td>

                  <td className={TD}>
                    {started ? (
                      <button
                        type="button"
                        onClick={() =>
                          setEnteringId(
                            enteringId === order._id ? null : order._id
                          )
                        }
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full border border-slate-300 dark:border-surface-border text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition duration-150"
                      >
                        {enteringId === order._id ? "Close" : "Enter Result"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleStart(order)}
                        disabled={starting === order._id}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full bg-primary-600 text-white text-xs font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-50 disabled:pointer-events-none"
                      >
                        <Play weight="duotone" className="w-3.5 h-3.5" aria-hidden="true" />
                        {starting === order._id ? "Starting…" : "Start Test"}
                      </button>
                    )}
                  </td>
                </motion.tr>
              ))
            )}

            {/* The result form, generated from this order's LabTest
                definition. One component for every test - see
                LabResultForm.jsx. */}
            {started &&
              orders
                .filter((order) => order._id === enteringId)
                .map((order) => (
                  <tr key={`${order._id}-form`}>
                    <td colSpan={6} className="px-4 pb-4">
                      <LabResultForm
                        labOrderId={order._id}
                        onSaved={async () => {
                          setEnteringId(null);
                          await load({ quiet: true });
                        }}
                        onCancel={() => setEnteringId(null)}
                      />
                    </td>
                  </tr>
                ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary-600 flex items-center justify-center">
            <Flask weight="duotone" className="w-5 h-5 text-white" aria-hidden="true" />
          </div>
          <div className="leading-tight">
            <h1 className="text-[22px] font-bold text-slate-900 dark:text-white tracking-tight">
              Laboratory Worklist
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tests ordered by doctors, oldest first
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => load({ quiet: true })}
          disabled={refreshing}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-slate-300 dark:border-surface-border bg-white dark:bg-surface text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-white/5 transition-colors duration-150 disabled:opacity-60"
        >
          <ArrowClockwise weight="bold" className="w-4 h-4" aria-hidden="true" />
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      <section className="mb-8">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
          Pending lab orders
          <span className="ml-2 text-slate-400 font-normal tabular-nums">
            {worklist.pending.length}
          </span>
        </h2>
        {renderTable(worklist.pending, { started: false })}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-slate-900 dark:text-white mb-3">
          In progress
          <span className="ml-2 text-slate-400 font-normal tabular-nums">
            {worklist.inProgress.length}
          </span>
        </h2>
        {renderTable(worklist.inProgress, { started: true })}
      </section>
    </div>
  );
}

export default LabTechnicianDashboard;
