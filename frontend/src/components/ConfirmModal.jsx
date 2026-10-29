import { useState, useEffect } from 'react';
import { Trash, Warning, Info } from '@phosphor-icons/react';

/**
 * ConfirmModal — drop-in replacement for window.confirm()
 *
 * Usage:
 *   const [modal, setModal] = useState(null);
 *   // trigger:
 *   setModal({ title: 'Delete Doctor', message: '…', onConfirm: () => handleDelete() });
 *   // render:
 *   <ConfirmModal config={modal} onClose={() => setModal(null)} />
 */

// Pill buttons, matching the redesigned pages.
const BTN_BASE =
  'inline-flex items-center justify-center h-11 px-5 rounded-full text-sm font-semibold text-white active:scale-[0.98] transition duration-150';

const BTN_OUTLINE =
  'inline-flex items-center justify-center h-11 px-5 rounded-full border border-slate-300 dark:border-surface-border text-slate-700 dark:text-slate-200 text-sm font-semibold hover:bg-slate-50 dark:hover:bg-white/[0.04] active:scale-[0.98] transition duration-150';

const VARIANTS = {
  danger: {
    icon: <Trash weight="duotone" className="w-6 h-6 text-danger-600 dark:text-danger-400" aria-hidden />,
    iconBg: 'bg-danger-50 dark:bg-danger-500/10',
    confirmBtn: `${BTN_BASE} bg-danger-600 hover:bg-danger-700`,
    confirmLabel: 'Delete',
  },
  warning: {
    icon: <Warning weight="duotone" className="w-6 h-6 text-warning-600 dark:text-warning-400" aria-hidden />,
    iconBg: 'bg-warning-50 dark:bg-warning-500/10',
    confirmBtn: `${BTN_BASE} bg-warning-600 hover:bg-warning-700`,
    confirmLabel: 'Confirm',
  },
  info: {
    icon: <Info weight="duotone" className="w-6 h-6 text-primary-600 dark:text-primary-400" aria-hidden />,
    iconBg: 'bg-primary-50 dark:bg-primary-500/10',
    confirmBtn: `${BTN_BASE} bg-primary-600 hover:bg-primary-700`,
    confirmLabel: 'Confirm',
  },
};

export default function ConfirmModal({ config, onClose }) {
  const [activeConfig, setActiveConfig] = useState(null);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (config) {
      setActiveConfig(config);
      setIsOpen(true);
    } else if (activeConfig) {
      setIsOpen(false);
      const timer = setTimeout(() => {
        setActiveConfig(null);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [config, activeConfig]);

  if (!activeConfig) return null;

  const {
    title = 'Are you sure?',
    message,
    variant = 'danger',
    confirmLabel,
    cancelLabel = 'Cancel',
    onConfirm,
  } = activeConfig;

  const v = VARIANTS[variant] || VARIANTS.danger;
  const btnLabel = confirmLabel || v.confirmLabel;

  const handleConfirm = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      if (onConfirm) {
        await onConfirm();
      }
    } finally {
      setIsOpen(false);
      setTimeout(() => {
        onClose();
      }, 200);
    }
  };

  const handleCancel = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsOpen(false);
    setTimeout(() => {
      onClose();
    }, 200);
  };

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 overflow-hidden"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/50 dark:bg-slate-950/60 backdrop-blur-sm modal-backdrop"
        data-state={isOpen ? 'open' : 'closed'}
        onClick={handleCancel}
        aria-hidden="true"
      />

      {/* Panel */}
      <div 
        className="relative w-full max-w-md p-6 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04),0_24px_48px_-16px_rgba(15,23,42,0.28)] max-h-[90vh] overflow-y-auto modal-panel"
        data-state={isOpen ? 'open' : 'closed'}
      >
        <div className="flex items-start gap-4">
          <div className={`${v.iconBg} w-12 h-12 rounded-xl flex items-center justify-center shrink-0`}>
            {v.icon}
          </div>

          <div className="flex-1 min-w-0">
            <h2
              id="confirm-modal-title"
              className="text-lg font-semibold text-slate-900 dark:text-white mb-1.5"
            >
              {title}
            </h2>

            {message && (
              <p className="text-sm text-slate-500 dark:text-slate-400 leading-relaxed">
                {message}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3 mt-6">
          <button
            type="button"
            onClick={handleCancel}
            className={BTN_OUTLINE}
          >
            {cancelLabel}
          </button>

          <button
            type="button"
            onClick={handleConfirm}
            className={v.confirmBtn}
          >
            {btnLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
