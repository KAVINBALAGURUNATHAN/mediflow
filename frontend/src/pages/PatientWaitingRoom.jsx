import { useState, useCallback, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { motion, useReducedMotion } from 'motion/react';
import { MagnifyingGlass, WarningCircle, Ticket } from '@phosphor-icons/react';
import useSocket from '../hooks/useSocket';
import WaitingRoomDisplay from '../components/WaitingRoomDisplay';
import { waitingRoomAPI } from '../services/api';

const EASE = [0.16, 1, 0.3, 1];

const PatientWaitingRoom = () => {
  // Token numbers are only unique per doctor per day, so the backend
  // requires both doctorId and tokenNumber (GET
  // /waiting-room/:doctorId/:tokenNumber) - doctorId comes from the route,
  // the token input lets a patient re-check a different token for the same
  // doctor without leaving the page.
  const { doctorId, tokenNumber } = useParams();
  const reduceMotion = useReducedMotion();
  const [tokenInput, setTokenInput] = useState(tokenNumber || '');
  const [waitData, setWaitData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeToken, setActiveToken] = useState(null);

  const fetchWait = useCallback(async (token) => {
    if (!token || !doctorId) return;
    setLoading(true);
    setError('');
    try {
      const res = await waitingRoomAPI.getStatus(doctorId, token);
      const json = res.data;
      if (!json) throw new Error('Token not found');
      setWaitData(json);
    } catch (e) {
      setError(e.response?.data?.message || e.message || 'Token not found');
      setWaitData(null);
    } finally {
      setLoading(false);
    }
  }, [doctorId]);

  useEffect(() => {
    const t = parseInt(tokenNumber, 10);
    if (t && t >= 1) {
      setActiveToken(t);
      fetchWait(t);
    }
    // Only re-run when the URL itself changes to a different doctor/token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId, tokenNumber]);

  const handleCheck = (e) => {
    e.preventDefault();
    const t = parseInt(tokenInput, 10);
    if (!t || t < 1) {
      setError('Enter a valid token number');
      return;
    }
    setActiveToken(t);
    fetchWait(t);
  };

  const handleQueueUpdated = useCallback(() => {
    if (activeToken) fetchWait(activeToken);
  }, [activeToken, fetchWait]);

  useSocket('queueUpdated', handleQueueUpdated);

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-5xl mx-auto">
        <motion.header
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="mb-8"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary-50 dark:bg-secondary-500/10 mb-4">
            <span className="live-dot scale-75" aria-hidden="true" />
            <span className="text-xs font-semibold text-secondary-700 dark:text-secondary-400">
              Live queue
            </span>
          </div>
          <h1 className="text-[32px] sm:text-4xl font-bold tracking-tight text-slate-900 dark:text-white">
            Waiting room
          </h1>
          <p className="text-slate-500 dark:text-slate-400 mt-2">
            Check your position in the queue and estimated wait time. This screen updates itself as
            the queue moves.
          </p>
        </motion.header>

        <motion.form
          onSubmit={handleCheck}
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : 0.05 }}
          className="bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] p-5 sm:p-6 mb-6"
        >
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-500/10 flex items-center justify-center shrink-0">
              <Ticket weight="duotone" className="w-5 h-5" aria-hidden />
            </div>
            <div className="min-w-0">
              <label
                htmlFor="token-input"
                className="block text-sm font-semibold text-slate-900 dark:text-white"
              >
                Your token number
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Printed on your booking confirmation
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <input
              id="token-input"
              type="number"
              min={1}
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="07"
              className="flex-1 h-16 rounded-xl border border-slate-300 dark:border-surface-border bg-white dark:bg-surface text-slate-900 dark:text-white text-3xl sm:text-4xl font-mono font-bold text-center tracking-[0.25em] placeholder:text-slate-400 outline-none transition duration-150 focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
              aria-describedby={error ? 'token-error' : undefined}
            />
            <button
              type="submit"
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 h-16 px-7 rounded-xl bg-primary-600 text-white text-base font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 disabled:opacity-60 disabled:pointer-events-none shrink-0"
            >
              {loading ? (
                <span
                  className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"
                  aria-label="Checking token"
                />
              ) : (
                <>
                  <MagnifyingGlass weight="bold" className="w-5 h-5" aria-hidden />
                  Check status
                </>
              )}
            </button>
          </div>

          {error && (
            <p
              id="token-error"
              className="mt-3 flex items-center gap-2 text-sm font-medium text-danger-600 dark:text-danger-400"
              role="alert"
            >
              <WarningCircle weight="duotone" className="w-4 h-4 shrink-0" aria-hidden />
              {error}
            </p>
          )}
        </motion.form>

        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE, delay: reduceMotion ? 0 : 0.08 }}
        >
          <WaitingRoomDisplay data={waitData} loading={loading && !!activeToken} />
        </motion.div>
      </div>
    </div>
  );
};

export default PatientWaitingRoom;
