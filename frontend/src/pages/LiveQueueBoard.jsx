import { useState, useEffect } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Broadcast,
  CheckCircle,
  ClipboardText,
  Clock,
  Hourglass,
  Stethoscope,
  Timer,
  UserFocus,
  WifiSlash,
} from "@phosphor-icons/react";
import { receptionistAPI, settingsAPI } from "../services/api";
import useSocket from "../hooks/useSocket";
import socket from "../services/socket";
import { isInQueue } from '../utils/queueStatus';

const EASE = [0.16, 1, 0.3, 1];

const CARD =
  "bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]";

const priorityRank = { High: 3, Normal: 2, Low: 1 };

// Status-token palette shared with the rest of the app, now with the `dark:`
// half restored so the board follows the themed dashboard shell instead of
// forcing a light surface underneath a dark chrome.
const priorityColor = {
  High: { badge: "bg-danger-50 text-danger-700 dark:bg-danger-500/15 dark:text-danger-400" },
  Normal: { badge: "bg-primary-50 text-primary-700 dark:bg-primary-500/15 dark:text-primary-300" },
  Low: { badge: "bg-slate-100 text-slate-700 dark:bg-surface dark:text-slate-300" },
};

// Meant to be read from across a waiting room, not a typical dashboard tile
// glanced at up close - the numbers need to dominate the card, not the label.
function StatCard({ label, value, Icon, tone }) {
  return (
    <div className={`${CARD} p-5`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${tone}`}>
        <Icon weight="duotone" className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-[40px] sm:text-[48px] leading-none font-bold font-mono text-slate-900 dark:text-white">
        {value}
      </p>
      <p className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400 mt-3">
        {label}
      </p>
    </div>
  );
}

// Small, subtle indicator - only ever "Live" (socket connected) or
// "Live updates unavailable" (disconnected). No continuously-animated
// counters, per the "subtle fade transitions only" design rule.
function LiveStatusIndicator({ connected }) {
  return (
    <span
      className={`inline-flex items-center gap-2 h-9 px-4 rounded-full text-sm font-semibold ${
        connected
          ? "bg-success-50 text-success-700 dark:bg-success-500/10 dark:text-success-300"
          : "bg-warning-50 text-warning-700 dark:bg-warning-500/10 dark:text-warning-300"
      }`}
    >
      {connected ? (
        <>
          <Broadcast weight="duotone" className="w-4 h-4" aria-hidden />
          Live
        </>
      ) : (
        <>
          <WifiSlash weight="duotone" className="w-4 h-4" aria-hidden />
          Live updates unavailable
        </>
      )}
    </span>
  );
}

const LiveQueueBoard = () => {
  const reduceMotion = useReducedMotion();
  const [patients, setPatients] = useState([]);
  const [avgTime, setAvgTime] = useState(10);
  const [socketConnected, setSocketConnected] = useState(socket.connected);

  const rise = (delay = 0) => ({
    initial: reduceMotion ? false : { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : delay },
  });

  useEffect(() => {
    // "connect" only fires once per handshake - in React.StrictMode (see
    // main.jsx) this effect runs, cleans up, then runs again, and if the
    // socket connects in that gap the event is gone forever, leaving this
    // stuck on "Live updates unavailable" even though the socket is
    // actually connected. Re-sync to the real current state every time the
    // effect (re)runs, rather than relying solely on catching the event.
    setSocketConnected(socket.connected);
    const onConnect = () => setSocketConnected(true);
    const onDisconnect = () => setSocketConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    };
  }, []);

  const fetchConsultationTime = async () => {
    try {
      const res = await settingsAPI.getTime();
      if (res.data?.averageConsultationTime !== undefined) {
        setAvgTime(res.data.averageConsultationTime);
      }
    } catch (error) {
      console.error(error);
    }
  };

  const fetchQueue = async () => {
    try {
      const res = await receptionistAPI.getAppointments();
      const list = res.data?.appointments || [];
      // Normalize patientName -> name so the display logic below (which
      // predates the Appointment-model rewrite) keeps working unchanged.
      // Only patients who have actually arrived belong on the live queue.
      // Arrival is checkedInAt: tokens are assigned at booking now, so a
      // token-based filter would board everyone booked for the day, including
      // people still at home.
      const checkedIn = list
        .filter(isInQueue)
        .map((appt) => ({ ...appt, name: appt.patientName }));
      setPatients(checkedIn);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    fetchQueue();
    fetchConsultationTime();
  }, []);

  useSocket("queueUpdated", fetchQueue);

  const currentPatient = patients.find(
    (p) => p.status?.toLowerCase() === "in consultation"
  );

  const upcomingPatients = patients
    .filter((p) => p.status?.toLowerCase() === "waiting")
    .sort((a, b) => {
      const rankA = priorityRank[a.priority] || 2;
      const rankB = priorityRank[b.priority] || 2;
      if (rankB !== rankA) {
        return rankB - rankA;
      }
      return a.tokenNumber - b.tokenNumber;
    });

  const nextPatient = upcomingPatients[0] || null;
  const queuePatients = upcomingPatients.slice(1, 20);
  const nextColor = priorityColor[nextPatient?.priority] || priorityColor.Normal;
  const currentColor = priorityColor[currentPatient?.priority] || priorityColor.Normal;

  const waitingCount = upcomingPatients.length;
  const servedCount = patients.filter((p) => p.status?.toLowerCase() === "completed").length;

  // "Active" means there's something happening right now - either a patient
  // waiting or one already in consultation. Only when NEITHER is true do we
  // fall back to the completed/not-started full-page states below - a
  // consultation actively in progress should never be hidden just because
  // nobody else is currently waiting behind it.
  const hasActiveQueue = waitingCount > 0 || Boolean(currentPatient);

  return (
    // min-h-[calc(100vh-4rem)], not min-h-screen: this page renders inside
    // the dashboard shell's sticky 4rem (h-16) Header - assuming a full
    // 100vh here pushed the page content taller than the actual space below
    // that header, clipping into it. justify-center balances the content in
    // whatever space remains instead of pinning everything to the top and
    // leaving a large empty gap under a short queue.
    <div className="min-h-[calc(100vh-4rem)] pt-24 px-4 sm:px-6 lg:px-8 pb-12 flex flex-col justify-center">
      <div className="max-w-[1400px] w-full mx-auto">

        {/* HEADER */}
        <motion.header
          {...rise()}
          className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-8"
        >
          <div>
            <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em] mb-2">
              Live Queue Display
            </p>
            <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
              MediFlow
            </h1>
            <p className="text-slate-500 dark:text-slate-400 mt-2">
              Please wait for your token number to be called.
            </p>
          </div>

          <div className="shrink-0">
            <LiveStatusIndicator connected={socketConnected} />
          </div>
        </motion.header>

        {!hasActiveQueue ? (
          // Case 2 (servedCount > 0) / Case 3 (servedCount === 0) - the queue
          // being empty right now is never automatically "completed". Zero
          // patients served today means the queue hasn't started, not that
          // it's finished - that distinction is the entire point of this fix.
          <motion.div {...rise(0.04)} className={`${CARD} p-6 sm:p-8 mb-8 flex items-center gap-5`}>
            {servedCount > 0 ? (
              <>
                <div className="w-14 h-14 rounded-2xl bg-success-50 dark:bg-success-500/10 flex items-center justify-center shrink-0">
                  <CheckCircle weight="duotone" className="w-8 h-8 text-success-600" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                    Today's appointments have been completed
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">
                    All scheduled patients have been served.
                  </p>
                </div>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-2xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                  <Clock weight="duotone" className="w-8 h-8 text-primary-600" aria-hidden />
                </div>
                <div className="min-w-0">
                  <p className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white">
                    No appointments are currently scheduled
                  </p>
                  <p className="text-slate-600 dark:text-slate-400 mt-1">
                    Today's queue has not started.
                  </p>
                </div>
              </>
            )}
          </motion.div>
        ) : (
          <>
            {/* Now Serving + Next Call — side by side */}
            <motion.div {...rise(0.04)} className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">

              <div className={`${CARD} p-6 sm:p-8 text-center`}>
                <p className="text-xs sm:text-sm font-bold tracking-[0.2em] text-primary-600 dark:text-primary-400 uppercase">
                  Now Serving
                </p>
                {currentPatient ? (
                  <>
                    <p className="mt-5 text-[6rem] sm:text-[7.5rem] font-bold font-mono leading-none tracking-tight text-primary-600 dark:text-primary-400">
                      {String(currentPatient.tokenNumber).padStart(2, "0")}
                    </p>
                    <p className="text-xl sm:text-2xl font-semibold mt-5 text-slate-900 dark:text-white">
                      {currentPatient.name}
                    </p>
                    <span
                      className={`inline-block text-sm font-bold uppercase tracking-wide px-5 py-1.5 rounded-full mt-3 ${currentColor.badge}`}
                    >
                      {currentPatient.priority?.toUpperCase()}
                    </span>
                    {currentPatient.priorityReason && (
                      <p className="mt-3 text-sm font-semibold text-danger-600 dark:text-danger-400">
                        {currentPatient.priorityReason}
                      </p>
                    )}
                  </>
                ) : (
                  <div className="py-10 flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-surface flex items-center justify-center mb-4">
                      <UserFocus weight="duotone" className="w-8 h-8 text-slate-600 dark:text-slate-300" aria-hidden />
                    </div>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">
                      {servedCount === 0 ? "Waiting for first patient" : "No consultation in progress"}
                    </p>
                  </div>
                )}
              </div>

              <div className={`${CARD} p-6 sm:p-8 text-center`}>
                <p className="text-xs sm:text-sm font-bold tracking-[0.2em] text-slate-600 dark:text-slate-400 uppercase">
                  Next Call
                </p>
                {nextPatient ? (
                  <>
                    <p className="mt-5 text-[6rem] sm:text-[7.5rem] font-bold font-mono leading-none tracking-tight text-slate-900 dark:text-white">
                      {String(nextPatient.tokenNumber).padStart(2, "0")}
                    </p>
                    <p className="text-xl sm:text-2xl font-semibold mt-5 text-slate-900 dark:text-white">
                      {nextPatient.name}
                    </p>
                    <span
                      className={`inline-block text-sm font-bold uppercase tracking-wide px-5 py-1.5 rounded-full mt-3 ${nextColor.badge}`}
                    >
                      {nextPatient.priority?.toUpperCase()}
                    </span>
                    {nextPatient.priorityReason && (
                      <p className="mt-3 text-sm font-semibold text-danger-600 dark:text-danger-400">
                        {nextPatient.priorityReason}
                      </p>
                    )}
                    <p className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400">
                      <Timer weight="duotone" className="w-4 h-4" aria-hidden />
                      Estimated wait: {avgTime} min
                    </p>
                  </>
                ) : (
                  <div className="py-10 flex flex-col items-center">
                    <div className="w-14 h-14 rounded-2xl bg-slate-100 dark:bg-surface flex items-center justify-center mb-4">
                      <Hourglass weight="duotone" className="w-8 h-8 text-slate-600 dark:text-slate-300" aria-hidden />
                    </div>
                    <p className="text-lg font-semibold text-slate-700 dark:text-slate-300">
                      No patients currently waiting
                    </p>
                    <p className="text-sm text-slate-600 dark:text-slate-400 mt-1.5 max-w-xs">
                      When new appointments check in, the next patient will appear here.
                    </p>
                  </div>
                )}
              </div>

            </motion.div>

            {/* Upcoming Queue — Table */}
            <motion.section {...rise(0.08)} className={`${CARD} mb-8 overflow-hidden`}>
              <div className="flex items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-slate-200 dark:border-surface-border">
                <h2 className="text-sm font-bold tracking-[0.2em] uppercase text-slate-600 dark:text-slate-400">
                  Upcoming Tokens
                </h2>
                {queuePatients.length > 0 && (
                  <span className="text-sm font-mono font-bold text-slate-700 dark:text-slate-300">
                    {queuePatients.length}
                  </span>
                )}
              </div>

              {queuePatients.length === 0 ? (
                <div className="flex items-center gap-4 px-5 sm:px-6 py-5">
                  <div className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-surface flex items-center justify-center shrink-0">
                    <ClipboardText weight="duotone" className="w-6 h-6 text-slate-600 dark:text-slate-300" aria-hidden />
                  </div>
                  <p className="text-base font-semibold text-slate-700 dark:text-slate-300">
                    No further tokens in the queue
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-surface">
                        {["Token", "Patient", "Priority", "Est. wait"].map((h) => (
                          <th
                            key={h}
                            scope="col"
                            className="text-left px-5 sm:px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-surface-border whitespace-nowrap"
                          >
                            {h}
                          </th>
                        ))}
                        <th
                          scope="col"
                          className="text-right px-5 sm:px-6 py-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-surface-border whitespace-nowrap"
                        >
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {queuePatients.map((p, index) => {
                        const c = priorityColor[p.priority] || priorityColor.Normal;
                        return (
                          <tr
                            key={p._id}
                            className="border-b border-slate-100 dark:border-surface-border last:border-0 hover:bg-slate-50 dark:hover:bg-surface transition-colors duration-150"
                          >
                            <td className="px-5 sm:px-6 py-4 text-3xl font-bold font-mono leading-none text-primary-600 dark:text-primary-400">
                              {String(p.tokenNumber).padStart(2, "0")}
                            </td>
                            <td className="px-5 sm:px-6 py-4 text-lg font-medium text-slate-900 dark:text-white">
                              {p.name}
                            </td>
                            <td className="px-5 sm:px-6 py-4">
                              <span
                                className={`inline-block text-xs font-bold uppercase tracking-wide px-3 py-1 rounded-full ${c.badge}`}
                              >
                                {p.priority?.toUpperCase()}
                              </span>
                              {p.priorityReason && (
                                <span className="block mt-1.5 text-[11px] font-semibold text-danger-600 dark:text-danger-400">
                                  {p.priorityReason}
                                </span>
                              )}
                            </td>
                            <td className="px-5 sm:px-6 py-4 text-base font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                              ~ {(index + 2) * avgTime} min
                            </td>
                            <td className="px-5 sm:px-6 py-4 text-right">
                              <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-warning-700 dark:text-warning-400">
                                <Hourglass weight="duotone" className="w-4 h-4" aria-hidden />
                                Waiting
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </motion.section>
          </>
        )}

        {/* Statistics */}
        <motion.div {...rise(0.12)} className="grid grid-cols-2 xl:grid-cols-4 gap-5">
          <StatCard
            label="Waiting"
            value={waitingCount}
            Icon={Hourglass}
            tone="bg-warning-50 text-warning-600 dark:bg-warning-500/10"
          />
          <StatCard
            label="In consultation"
            value={currentPatient ? 1 : 0}
            Icon={Stethoscope}
            tone="bg-primary-50 text-primary-600 dark:bg-primary-500/10"
          />
          <StatCard
            label="Completed today"
            value={servedCount}
            Icon={CheckCircle}
            tone="bg-success-50 text-success-600 dark:bg-success-500/10"
          />
          <StatCard
            label="Avg. wait time"
            value={`${avgTime}m`}
            Icon={Timer}
            tone="bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10"
          />
        </motion.div>

      </div>
    </div>
  );
};

export default LiveQueueBoard;
