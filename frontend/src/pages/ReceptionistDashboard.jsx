import { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import {
  ArrowsClockwise,
  CalendarBlank,
  CalendarPlus,
  CheckCircle,
  Hourglass,
  SignIn,
  Timer,
  Ticket,
  UsersThree,
  Warning,
} from '@phosphor-icons/react';
import { receptionistAPI, settingsAPI } from '../services/api';
import useSocket from '../hooks/useSocket';
import { useToast } from '../context/ToastContext';
import ConfirmModal from '../components/ConfirmModal';
import { getStatusBadgeClass } from '../utils/statusBadge';
import { isCheckedIn, isInQueue, isAwaitingCheckIn } from '../utils/queueStatus';

import QueueTable from '../components/QueueTable';
import WaitingList from '../components/WaitingList';
import CurrentTokenCard from '../components/CurrentTokenCard';
import QueueTimeline from '../components/QueueTimeline';
import useFirstMountThisSession from '../hooks/useFirstMountThisSession';

const EASE = [0.16, 1, 0.3, 1];

const CARD =
  'bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

// Same anatomy as the approved PatientDashboard/Analytics tile: tinted icon
// badge, mono value, label, then a caption that only ever restates numbers
// already present in the payload.
function StatCard({ label, value, caption, Icon, tone }) {
  return (
    <div className={`${CARD} p-5`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${tone}`}>
        <Icon weight="duotone" className="w-5 h-5" aria-hidden />
      </div>
      <p className="text-[28px] leading-none font-bold text-slate-900 dark:text-white font-mono">{value}</p>
      <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">{label}</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{caption}</p>
    </div>
  );
}

function SummaryRow({ label, value, Icon, tone }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tone}`}>
        <Icon weight="duotone" className="w-5 h-5" aria-hidden />
      </div>
      <span className="text-sm text-slate-600 dark:text-slate-400 flex-1">{label}</span>
      <span className="font-mono font-bold text-slate-900 dark:text-white">{value}</span>
    </div>
  );
}

const ReceptionistDashboard = () => {
  const toast = useToast();
  const shouldAnimate = useFirstMountThisSession('receptionist-dashboard');
  const reduceMotion = useReducedMotion();
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [avgTime, setAvgTime] = useState(0);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [confirmModal, setConfirmModal] = useState(null);
  const [upcoming, setUpcoming] = useState([]);
  const [upcomingLoading, setUpcomingLoading] = useState(true);
  // Mirrors Settings.graceMinutes, refreshed with every appointments fetch.
  // The default matches the server's DEFAULT_GRACE_MINUTES so the first
  // render before the fetch lands says the same thing as the one after it.
  const [graceMinutes, setGraceMinutes] = useState(5);

  const animate = shouldAnimate && !reduceMotion;
  const rise = (delay = 0) => ({
    initial: animate ? { opacity: 0, y: 12 } : false,
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.3, ease: EASE, delay: animate ? delay : 0 },
  });

  // ===========================
  // FETCH APPOINTMENTS
  // ===========================
  const fetchPatients = useCallback(async () => {
    try {
      const res = await receptionistAPI.getAppointments();

      const list = res.data?.appointments || [];

      const sorted = Array.isArray(list)
        ? [...list].sort(
            (a, b) =>
              new Date(a.appointmentDate) -
              new Date(b.appointmentDate)
          )
        : [];

      setPatients(sorted);
      // The server owns the grace period (Settings.graceMinutes), so the
      // number the desk reads comes from the same place the rule is
      // enforced rather than being written twice.
      if (res.data?.graceMinutes !== undefined) {
        setGraceMinutes(res.data.graceMinutes);
      }
      setLastUpdated(new Date());
    } catch (error) {
      console.error(
        'fetchPatients:',
        error.response?.data?.message || error.message
      );
    } finally {
      setLoading(false);
    }
  }, []);

  // ===========================
  // FETCH UPCOMING (Tomorrow / Future Bookings)
  // ===========================
  const fetchUpcoming = useCallback(async () => {
    try {
      const res = await receptionistAPI.getUpcomingAppointments();
      const list = res.data?.appointments || [];

      const future = list
        .filter((a) => new Date(a.appointmentDate).toDateString() !== new Date().toDateString())
        .sort((a, b) => new Date(a.appointmentDate) - new Date(b.appointmentDate));

      setUpcoming(future);
    } catch (error) {
      console.error(
        'fetchUpcoming:',
        error.response?.data?.message || error.message
      );
    } finally {
      setUpcomingLoading(false);
    }
  }, []);

  // ===========================
  // FETCH CONSULTATION TIME
  // ===========================
  const fetchConsultationTime = useCallback(async () => {
    try {
      const res = await settingsAPI.getTime();

      if (res.data?.averageConsultationTime !== undefined) {
        setAvgTime(res.data.averageConsultationTime);
      }
    } catch (error) {
      console.error(
        'fetchConsultationTime:',
        error.response?.data?.message || error.message
      );
    }
  }, []);

  // ===========================
  // INITIAL LOAD
  // ===========================
  useEffect(() => {
    fetchPatients();
    fetchConsultationTime();
    fetchUpcoming();
  }, [fetchPatients, fetchConsultationTime, fetchUpcoming]);

  // ===========================
  // SOCKET QUEUE UPDATE
  // ===========================
  const handleQueueUpdated = useCallback(() => {
    setLastUpdated(new Date());
    fetchPatients();
    fetchUpcoming();
  }, [fetchPatients, fetchUpcoming]);

  useSocket('queueUpdated', handleQueueUpdated);

  // ===========================
  // SOCKET SETTINGS UPDATE
  // ===========================
  const handleSettingsUpdated = useCallback((data) => {
    if (data?.avgConsultationTime !== undefined) {
      setAvgTime(data.avgConsultationTime);
    }
  }, []);

  useSocket('settingsUpdated', handleSettingsUpdated);

  // ===========================
  // CANCEL APPOINTMENT
  // ===========================
  const handleDelete = async (id) => {
    setConfirmModal({
      title: 'Cancel Appointment',
      message: 'Are you sure you want to cancel this appointment?',
      variant: 'danger',
      confirmLabel: 'Cancel Appointment',
      onConfirm: async () => {
        try {
          await receptionistAPI.cancelAppointment(id);

          // Both lists, because Cancel appears in both.
          //
          // This used to filter `patients` alone, which is TODAY's queue -
          // but the Upcoming bookings section below renders from `upcoming`,
          // a separate fetch. Cancelling a future booking therefore succeeded
          // in the database, showed "Appointment cancelled successfully", and
          // left the row sitting there with its Cancel button, so the desk
          // could not tell whether it had worked.
          //
          // Refetching rather than filtering by hand: the server decides what
          // belongs in each list (a cancelled appointment drops out of both),
          // and two hand-maintained copies of that rule is how they drifted
          // apart in the first place.
          await Promise.all([fetchPatients(), fetchUpcoming()]);

          setLastUpdated(new Date());
          toast.success('Appointment cancelled successfully');
        } catch (error) {
          console.error(
            'cancel appointment:',
            error.response?.data?.message || error.message
          );
          toast.error(error.response?.data?.message || 'Failed to cancel appointment');
        }
      },
    });
  };

  // ===========================
  // QUEUE STATISTICS
  // ===========================
  // "Waiting" means waiting in the room, so it counts arrivals - not everyone
  // booked for today, who are also status "Waiting" until they are seen.
  const waiting = patients.filter(
    (patient) =>
      patient.status?.toLowerCase() === 'waiting' && isCheckedIn(patient)
  ).length;

  const serving = patients.find(
    (patient) =>
      patient.status?.toLowerCase() === 'in consultation'
  );

  const completed = patients.filter(
    (patient) =>
      patient.status?.toLowerCase() === 'completed'
  ).length;

  const inConsultation = patients.filter(
    (patient) =>
      patient.status?.toLowerCase() === 'in consultation'
  ).length;

  const highPriority = patients.filter(
    (patient) => patient.priority === 'High' && isInQueue(patient)
  ).length;

  const checkedInPatients = patients.filter(isInQueue);

  const awaitingCheckIn = patients.filter(isAwaitingCheckIn).length;

  // Everyone who turned up today, including those already seen - the
  // denominator for "how far through the day are we", which must not shrink
  // as patients are completed.
  const arrivedToday = patients.filter(isCheckedIn).length;

  const queueProgress =
    arrivedToday > 0 ? Math.round((completed / arrivedToday) * 100) : 0;

  const activeToken = serving?.tokenNumber || 0;

  const activeName =
    serving?.patientName ||
    serving?.name ||
    '';

  const activePatients = patients.filter(
    (patient) =>
      patient.status?.toLowerCase() !== 'completed' &&
      patient.status?.toLowerCase() !== 'cancelled'
  );

  const groupedUpcoming = useMemo(() => {
    const tomorrowStr = new Date(Date.now() + 24 * 60 * 60 * 1000).toDateString();
    const groups = new Map();

    upcoming.forEach((appt) => {
      const d = new Date(appt.appointmentDate);
      const key =
        d.toDateString() === tomorrowStr
          ? 'Tomorrow'
          : d.toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' });

      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(appt);
    });

    return Array.from(groups.entries());
  }, [upcoming]);

  // Skeleton mirrors the real layout (header, 4 tiles, 8/4 split) so the
  // page does not reflow once the first payload lands.
  if (loading) {
    return (
      <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-[1400px] mx-auto">
          <div className="h-4 w-32 bg-slate-100 dark:bg-surface rounded animate-pulse mb-3" />
          <div className="h-10 w-80 bg-slate-200 dark:bg-surface rounded-lg animate-pulse mb-3" />
          <div className="h-4 w-64 bg-slate-100 dark:bg-surface rounded animate-pulse mb-8" />
          <div className={`${CARD} h-32 animate-pulse mb-8`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className={`${CARD} h-36 animate-pulse`} />
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-8 space-y-6">
              <div className={`${CARD} h-32 animate-pulse`} />
              <div className={`${CARD} h-96 animate-pulse`} />
            </div>
            <div className="xl:col-span-4 space-y-6">
              <div className={`${CARD} h-72 animate-pulse`} />
              <div className={`${CARD} h-40 animate-pulse`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  const stats = [
    {
      label: "Today's appointments",
      value: patients.length,
      caption: 'Booked for today',
      Icon: CalendarBlank,
      tone: 'bg-primary-50 text-primary-600 dark:bg-primary-500/10',
    },
    {
      label: 'Checked in',
      value: checkedInPatients.length,
      caption: `${awaitingCheckIn} awaiting check-in`,
      Icon: SignIn,
      tone: 'bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10',
    },
    {
      label: 'Waiting',
      value: waiting,
      caption: avgTime > 0 ? `${avgTime} min average consultation` : 'In the queue now',
      Icon: Hourglass,
      tone: 'bg-warning-50 text-warning-600 dark:bg-warning-500/10',
    },
    {
      label: 'Completed',
      value: completed,
      caption:
        arrivedToday > 0
          ? `${completed} of ${arrivedToday} who arrived`
          : 'No patients seen yet',
      Icon: CheckCircle,
      tone: 'bg-success-50 text-success-600 dark:bg-success-500/10',
    },
  ];

  // The doctors who actually have patients today, derived from the list the
  // dashboard already loaded rather than fetched again - reception assigns a
  // vacancy in a schedule that is already on this screen.
  const waitingListDoctors = Array.from(
    new Map(
      (patients || [])
        .map((p) => p.doctorId)
        .filter((d) => d && d._id)
        .map((d) => [String(d._id), d])
    ).values()
  );

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-[1400px] mx-auto">

        {/* PAGE HEADER */}
        <motion.header
          {...rise()}
          className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4 mb-8"
        >
          <div>
            <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em] mb-2">
              Reception Desk
            </p>

            <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
              Appointment Check-In
            </h1>

            <p className="text-slate-500 dark:text-slate-400 mt-2 flex items-center gap-2">
              <span className="live-dot scale-75" aria-hidden="true" />

              {lastUpdated
                ? `Last updated ${lastUpdated.toLocaleTimeString(
                    'en-IN',
                    {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    }
                  )}`
                : 'Waiting for live updates…'}
            </p>
          </div>

          {/* REFRESH ONLY — NO RESET QUEUE */}
          <div className="flex gap-3 shrink-0">
            <button
              onClick={() => {
                fetchPatients();
                fetchConsultationTime();
              }}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 shadow-[0_8px_20px_-6px_rgba(37,99,235,0.5)]"
              aria-label="Refresh appointments"
            >
              <ArrowsClockwise weight="bold" className="w-4 h-4" aria-hidden />
              Refresh
            </button>
          </div>
        </motion.header>

        {/* CURRENT PATIENT */}
        <motion.div {...rise(0.04)} className="mb-8">
          <CurrentTokenCard
            currentToken={activeToken}
            patientName={activeName}
            estimatedDurationMinutes={serving?.estimatedDurationMinutes}
            consultationStartedAt={serving?.consultationStartedAt}
          />
        </motion.div>

        {/* TODAY'S STATS */}
        <motion.div
          {...rise(0.08)}
          className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-5 mb-8"
        >
          {stats.map((s) => (
            <StatCard key={s.label} {...s} />
          ))}
        </motion.div>

        {/* MAIN CONTENT: appointment list + upcoming (left) / queue summary + quick actions (right) */}
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">

          <motion.div {...rise(0.12)} className="xl:col-span-8 space-y-6">
            {/* QUEUE TIMELINE - at-a-glance token sequence, distinct from the full table below */}
            <QueueTimeline patients={checkedInPatients} />

            {/* APPOINTMENT LIST */}
            <QueueTable
              patients={activePatients}
              loading={loading}
              onDelete={handleDelete}
              onQueueUpdated={fetchPatients}
              graceMinutes={graceMinutes}
            />

            {/* WAITING LIST - the backup queue. Placed under the live queue
                because it is worked from it: a no-show above frees a slot
                that someone below is given. */}
            <WaitingList doctors={waitingListDoctors} />

            {/* UPCOMING BOOKINGS - Tomorrow / Future */}
            <section className={CARD}>
              <div className="flex items-center justify-between gap-3 p-5 sm:p-6 border-b border-slate-200 dark:border-surface-border">
                <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Upcoming bookings</h2>
                {!upcomingLoading && upcoming.length > 0 && (
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-400 font-mono">
                    {upcoming.length} scheduled
                  </span>
                )}
              </div>

              {upcomingLoading ? (
                <div className="p-5 sm:p-6 space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="h-14 rounded-xl bg-slate-100 dark:bg-surface animate-pulse" />
                  ))}
                </div>
              ) : groupedUpcoming.length === 0 ? (
                <div className="flex items-center gap-3 p-5 sm:p-6">
                  <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
                    <CalendarPlus weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      No upcoming bookings
                    </p>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                      Nothing is scheduled beyond today.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-slate-200 dark:divide-surface-border">
                  {groupedUpcoming.map(([dateLabel, appts]) => (
                    <div key={dateLabel} className="p-5 sm:p-6">
                      <div className="flex items-center justify-between gap-3 mb-3">
                        <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em]">
                          {dateLabel}
                        </p>
                        <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 font-mono">
                          {appts.length}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {appts.map((appt) => {
                          const initial = (appt.patientName || '?').trim().charAt(0).toUpperCase();
                          const hasToken = appt.tokenNumber !== null && appt.tokenNumber !== undefined;
                          const priorityCls =
                            appt.priority === 'High'
                              ? 'badge-priority-high'
                              : appt.priority === 'Low'
                                ? 'badge-priority-low'
                                : 'badge-priority-normal';

                          return (
                            <div
                              key={appt._id}
                              className="flex flex-wrap items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-surface-border hover:bg-slate-50 dark:hover:bg-surface transition-colors duration-150"
                            >
                              <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-500/10 text-primary-600 dark:text-primary-300 flex items-center justify-center font-bold text-sm shrink-0">
                                {initial}
                              </div>

                              {/* break-words rather than truncate: a long
                                  name is clinical information, and cutting
                                  "Balagurunathan" to "Balaguru…" at the desk
                                  is how the wrong patient gets called. basis-0
                                  with min-w-0 lets the block give way to the
                                  badges instead of forcing the row wider. */}
                              <div className="min-w-0 flex-1 basis-40">
                                <p className="font-medium text-slate-900 dark:text-white break-words">
                                  {appt.patientName}
                                </p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 break-words">
                                  {appt.slot} · Dr. {appt.doctorId?.name || 'Unknown'}
                                </p>
                              </div>

                              <span className={`${priorityCls} shrink-0`}>
                                {appt.priority || 'Normal'}
                              </span>

                              <span className="inline-flex items-center justify-center min-w-[2rem] h-7 px-1.5 rounded-lg font-mono text-xs font-bold bg-slate-100 dark:bg-surface text-slate-700 dark:text-slate-200 shrink-0">
                                {hasToken ? String(appt.tokenNumber).padStart(2, '0') : '—'}
                              </span>

                              <span className={`${getStatusBadgeClass(appt.status)} shrink-0`}>
                                {appt.status}
                              </span>

                              <button
                                onClick={() => handleDelete(appt._id)}
                                className="text-xs font-semibold text-danger-600 hover:text-danger-700 dark:text-danger-400 dark:hover:text-danger-300 shrink-0 transition-colors duration-150"
                                aria-label={`Cancel ${appt.patientName}`}
                              >
                                Cancel
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </motion.div>

          {/* SIDE PANEL */}
          <motion.div {...rise(0.16)} className="xl:col-span-4 space-y-6">
            <section className={`${CARD} p-6`}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">Queue summary</h2>

              <div className="space-y-3">
                <SummaryRow
                  label="Current token"
                  value={activeToken > 0 ? String(activeToken).padStart(2, '0') : '—'}
                  Icon={Ticket}
                  tone="bg-primary-50 text-primary-600 dark:bg-primary-500/10"
                />
                <SummaryRow
                  label="In consultation"
                  value={inConsultation}
                  Icon={UsersThree}
                  tone="bg-secondary-50 text-secondary-600 dark:bg-secondary-500/10"
                />
                <SummaryRow
                  label="High priority"
                  value={highPriority}
                  Icon={Warning}
                  tone="bg-danger-50 text-danger-600 dark:bg-danger-500/10"
                />
                <SummaryRow
                  label="Avg consultation"
                  value={avgTime > 0 ? `${avgTime}m` : '—'}
                  Icon={Timer}
                  tone="bg-warning-50 text-warning-600 dark:bg-warning-500/10"
                />
              </div>

              <div className="mt-5 pt-5 border-t border-slate-200 dark:border-surface-border">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Today's progress</span>
                  <span className="text-xs font-mono font-semibold text-slate-600 dark:text-slate-400">
                    {completed}/{arrivedToday} served
                  </span>
                </div>

                <div
                  className="w-full bg-slate-200 dark:bg-surface rounded-full h-2 overflow-hidden"
                  role="progressbar"
                  aria-valuenow={queueProgress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Patients served today"
                >
                  <div
                    className="bg-primary-600 h-2 rounded-full transition-[width] duration-500"
                    style={{ width: `${queueProgress}%` }}
                  />
                </div>
              </div>
            </section>

            <section className={`${CARD} p-6`}>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-white mb-5">Quick actions</h2>

              <button
                onClick={() => {
                  fetchPatients();
                  fetchConsultationTime();
                  fetchUpcoming();
                }}
                className="w-full inline-flex items-center gap-3 h-12 px-4 rounded-xl border border-slate-200 dark:border-surface-border text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-surface active:scale-[0.98] transition duration-150"
              >
                <ArrowsClockwise weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
                Refresh queue
              </button>
            </section>
          </motion.div>
        </div>

        <ConfirmModal
          config={confirmModal}
          onClose={() => setConfirmModal(null)}
        />
      </div>
    </div>
  );
};

export default ReceptionistDashboard;
