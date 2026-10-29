import PropTypes from 'prop-types';
import { motion, useReducedMotion } from 'motion/react';
import { Bell, UsersThree, Clock, CheckCircle } from '@phosphor-icons/react';

const EASE = [0.16, 1, 0.3, 1];

const CARD =
  'bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]';

const WaitingRoomDisplay = ({ data, loading }) => {
  const reduceMotion = useReducedMotion();

  const rise = (i = 0) =>
    reduceMotion
      ? {}
      : {
          initial: { opacity: 0, y: 10 },
          animate: { opacity: 1, y: 0 },
          transition: { duration: 0.3, ease: EASE, delay: i * 0.06 },
        };

  if (loading) {
    return (
      <div className="space-y-6" role="status" aria-label="Loading queue status">
        <div className={`${CARD} p-10 sm:p-12 text-center`}>
          <div className="h-4 w-32 mx-auto mb-6 rounded bg-slate-100 dark:bg-surface animate-pulse" />
          <div className="h-24 w-40 mx-auto mb-4 rounded-xl bg-slate-100 dark:bg-surface animate-pulse" />
          <div className="h-4 w-48 mx-auto rounded bg-slate-100 dark:bg-surface animate-pulse" />
        </div>
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className={`${CARD} p-5 text-center`}>
              <div className="h-3 w-16 mx-auto mb-3 rounded bg-slate-100 dark:bg-surface animate-pulse" />
              <div className="h-8 w-12 mx-auto rounded bg-slate-100 dark:bg-surface animate-pulse" />
            </div>
          ))}
        </div>
        <span className="sr-only">Connecting to queue…</span>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="text-center max-w-sm px-4">
          <div className="w-16 h-16 rounded-2xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center mx-auto mb-4">
            <Clock weight="duotone" className="w-8 h-8 text-primary-600" aria-hidden />
          </div>
          <p className="text-base font-semibold text-slate-900 dark:text-white">Check Your Wait Time</p>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 leading-relaxed">
            Enter your token number above to see your position in the queue and estimated wait
          </p>
        </div>
      </div>
    );
  }

  // NOTE: If your backend returns a strict status (e.g., data.status === 'In Consultation'),
  // it is safer to use that rather than checking the string message.
  const isServing =
    data.message?.includes('your turn') ||
    data.message?.includes("It's your turn");

  const isCompleted =
    data.message?.includes('completed') ||
    data.message?.includes('Consultation is completed');

  const tokensAhead = data.tokensAhead ?? 0;
  const yourToken = data.yourToken || data.token || 0;
  const currentToken = data.currentToken || 0;
  const totalInQueue = tokensAhead + (currentToken > 0 && yourToken > currentToken ? 1 : 0);

  const progressPercent =
    totalInQueue > 0
      ? Math.max(8, Math.min(100, ((totalInQueue - tokensAhead) / totalInQueue) * 100))
      : isServing
        ? 100
        : 0;

  const tiles = [
    {
      label: 'Now Serving',
      value: currentToken > 0 ? String(currentToken).padStart(2, '0') : '—',
      Icon: Bell,
      tone: 'bg-slate-100 text-slate-600 dark:bg-surface dark:text-slate-300',
      valueTone: 'text-slate-900 dark:text-white',
    },
    {
      label: 'Ahead of You',
      value: tokensAhead,
      Icon: UsersThree,
      tone: 'bg-warning-50 text-warning-600 dark:bg-warning-500/10',
      valueTone: 'text-warning-600 dark:text-warning-400',
    },
    {
      label: 'Est. Wait',
      value:
        data.estimatedWait > 0
          ? `${data.estimatedWait}m`
          : data.estimatedWait === 0
            ? 'Soon'
            : '—',
      Icon: Clock,
      tone: 'bg-primary-50 text-primary-600 dark:bg-primary-500/10',
      valueTone: 'text-primary-600 dark:text-primary-400',
    },
  ];

  return (
    <div className="space-y-6">
      <motion.div
        {...rise(0)}
        className={`relative overflow-hidden ${CARD} p-8 sm:p-12 text-center ${
          isServing ? 'ring-4 ring-primary-500/10 border-primary-500' : ''
        }`}
        aria-live="polite"
      >
        <p className="text-[11px] font-bold text-primary-600 dark:text-primary-400 uppercase tracking-[0.12em] mb-3">
          {isServing ? "It's Your Turn!" : isCompleted ? 'Consultation Complete' : 'Your Token'}
        </p>

        <div
          className="font-mono font-bold text-primary-600 dark:text-primary-400 leading-none my-4 sm:my-6"
          style={{ fontSize: 'clamp(4rem, 18vw, 8rem)' }}
        >
          {String(yourToken).padStart(2, '0')}
        </div>

        {data.name && (
          <p className="text-slate-900 dark:text-white font-semibold text-lg">{data.name}</p>
        )}

        {isServing && (
          <div className="mt-6 inline-flex items-center gap-2.5 px-4 py-2 bg-primary-50 dark:bg-primary-500/10 text-primary-700 dark:text-primary-300 rounded-full text-sm font-semibold">
            <span className="live-dot scale-75" aria-hidden="true" />
            Please proceed to the consultation room
          </div>
        )}

        {isCompleted && (
          <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-success-50 dark:bg-success-500/10 text-success-700 dark:text-success-300 rounded-full text-sm font-semibold">
            <CheckCircle weight="duotone" className="w-4 h-4" aria-hidden />
            Your consultation is complete. Thank you!
          </div>
        )}
      </motion.div>

      {!isServing && !isCompleted && (
        <>
          <motion.div {...rise(1)} className={`${CARD} p-5 sm:p-6`}>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-[0.07em]">
                Queue Position
              </p>
              <p className="text-xs font-semibold text-primary-600 dark:text-primary-400">
                {tokensAhead === 0 ? 'You are next' : `${tokensAhead} ahead`}
              </p>
            </div>
            <div className="h-1.5 rounded-full bg-slate-100 dark:bg-surface overflow-hidden">
              <div
                className="h-full rounded-full bg-primary-600 transition duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="flex justify-between mt-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400 font-mono">
              <span>Now: #{currentToken > 0 ? String(currentToken).padStart(2, '0') : '—'}</span>
              <span>You: #{String(yourToken).padStart(2, '0')}</span>
            </div>
          </motion.div>

          <motion.div {...rise(2)} className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
            {tiles.map(({ label, value, Icon, tone, valueTone }) => (
              <div key={label} className={`${CARD} p-5 sm:p-6`}>
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${tone}`}>
                  <Icon weight="duotone" className="w-5 h-5" aria-hidden />
                </div>
                <p className={`text-[28px] font-bold font-mono leading-none ${valueTone}`}>{value}</p>
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mt-2">{label}</p>
              </div>
            ))}
          </motion.div>
        </>
      )}

      <div
        className="flex items-center justify-center gap-3 px-4 py-3 rounded-2xl bg-primary-50 dark:bg-primary-500/10 border border-primary-200 dark:border-primary-500/20"
        role="status"
        aria-live="polite"
      >
        <span className="live-dot scale-75" aria-hidden="true" />
        <span className="text-xs font-semibold text-primary-700 dark:text-primary-300">
          Live updates enabled — this screen refreshes automatically
        </span>
      </div>
    </div>
  );
};

WaitingRoomDisplay.propTypes = {
  loading: PropTypes.bool,
  data: PropTypes.shape({
    message: PropTypes.string,
    tokensAhead: PropTypes.number,
    yourToken: PropTypes.number,
    token: PropTypes.number,
    currentToken: PropTypes.number,
    name: PropTypes.string,
    estimatedWait: PropTypes.number,
  }),
};

export default WaitingRoomDisplay;
