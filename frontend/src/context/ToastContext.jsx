import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

let idCounter = 0;

const ICONS = {
  success: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  ),
  error: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  ),
  warning: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
    </svg>
  ),
  info: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

const STYLES = {
  success: {
    bar: 'bg-success-500',
    icon: 'bg-success-100 dark:bg-success-500/20 text-success-600 dark:text-success-400',
    title: 'text-success-800 dark:text-success-300',
  },
  error: {
    bar: 'bg-danger-500',
    icon: 'bg-danger-100 dark:bg-danger-500/20 text-danger-600 dark:text-danger-400',
    title: 'text-danger-800 dark:text-danger-300',
  },
  warning: {
    bar: 'bg-warning-500',
    icon: 'bg-warning-100 dark:bg-warning-500/20 text-warning-600 dark:text-warning-400',
    title: 'text-warning-800 dark:text-warning-300',
  },
  info: {
    bar: 'bg-primary-500',
    icon: 'bg-primary-100 dark:bg-primary-500/20 text-primary-600 dark:text-primary-400',
    title: 'text-primary-800 dark:text-primary-300',
  },
};

function Toast({ toast, onDismiss, enterDelayMs = 0 }) {
  const s = STYLES[toast.type] || STYLES.info;
  return (
    <div
      className="relative flex items-start gap-3 w-full max-w-sm bg-white dark:bg-slate-800 rounded-2xl shadow-glass dark:shadow-glass-dark border border-slate-100 dark:border-slate-700/50 overflow-hidden toast-item pointer-events-auto"
      data-dismissing={toast.isDismissing ? 'true' : 'false'}
      style={{ transitionDelay: toast.isDismissing ? '0ms' : `${enterDelayMs}ms` }}
      role="alert"
      aria-live="assertive"
    >
      {/* colour bar */}
      <div className={`absolute left-0 top-0 h-full w-1 ${s.bar}`} aria-hidden="true" />

      <div className="flex items-start gap-3 p-4 pl-5 w-full">
        <div className={`${s.icon} p-2 rounded-xl shrink-0`}>
          {ICONS[toast.type]}
        </div>

        <div className="flex-1 min-w-0 pt-0.5">
          {toast.title && (
            <p className={`text-sm font-bold ${s.title} leading-tight mb-0.5`}>
              {toast.title}
            </p>
          )}
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-snug">
            {toast.message}
          </p>
        </div>

        <button
          onClick={() => onDismiss(toast.id)}
          className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors mt-0.5"
          aria-label="Dismiss notification"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef({});

  const dismiss = useCallback((id) => {
    if (timers.current[id]) {
      clearTimeout(timers.current[id]);
      delete timers.current[id];
    }
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, isDismissing: true } : t))
    );
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 200);
  }, []);

  const toast = useCallback((message, { type = 'info', title, duration = 4000 } = {}) => {
    const id = ++idCounter;
    setToasts((prev) => [...prev.slice(-4), { id, message, type, title }]);
    if (duration > 0) {
      timers.current[id] = setTimeout(() => dismiss(id), duration);
    }
    return id;
  }, [dismiss]);

  // Convenience shorthands
  toast.success = (msg, opts) => toast(msg, { type: 'success', ...opts });
  toast.error   = (msg, opts) => toast(msg, { type: 'error',   duration: 6000, ...opts });
  toast.warning = (msg, opts) => toast(msg, { type: 'warning', ...opts });
  toast.info    = (msg, opts) => toast(msg, { type: 'info',    ...opts });

  return (
    <ToastContext.Provider value={toast}>
      {children}

      {/* Portal-style container — fixed, top-right */}
      <div
        aria-label="Notifications"
        className="fixed top-20 right-4 z-[9999] flex flex-col gap-3 pointer-events-none w-full max-w-sm"
      >
        {toasts.map((t, index) => (
          <Toast
            key={t.id}
            toast={t}
            onDismiss={dismiss}
            enterDelayMs={Math.min(index, 3) * 40}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
