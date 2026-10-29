import { useEffect, useState, useRef } from "react";
import { WifiSlash, CheckCircle } from "@phosphor-icons/react";

// Production-style network indicator, mounted once at the app root.
// Deliberately silent while online (no permanent "Live" badge) - only
// speaks up when there's actually something wrong, and briefly confirms
// recovery. Pure browser APIs (navigator.onLine + online/offline events),
// no socket/server round-trip involved.
function NetworkStatus() {
  const [state, setState] = useState(() =>
    typeof navigator !== "undefined" && navigator.onLine === false ? "offline" : "online"
  );
  const reconnectTimeoutRef = useRef(null);

  useEffect(() => {
    const handleOffline = () => {
      clearTimeout(reconnectTimeoutRef.current);
      setState("offline");
    };

    const handleOnline = () => {
      setState("reconnected");
      reconnectTimeoutRef.current = setTimeout(() => setState("online"), 2000);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearTimeout(reconnectTimeoutRef.current);
    };
  }, []);

  if (state === "online") return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-4 right-4 z-[100] animate-slide-down"
    >
      {state === "offline" ? (
        <div className="flex items-start gap-3 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.24)] px-4 py-3 max-w-xs">
          <span className="w-10 h-10 rounded-xl bg-danger-50 dark:bg-danger-500/10 text-danger-600 flex items-center justify-center shrink-0">
            <WifiSlash weight="duotone" className="w-5 h-5" aria-hidden />
          </span>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white">No Internet Connection</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Some features may not work. Retrying automatically…
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2.5 bg-white dark:bg-surface-card border border-slate-200 dark:border-surface-border rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-12px_rgba(15,23,42,0.24)] px-4 py-2.5">
          <CheckCircle weight="duotone" className="w-5 h-5 text-success-600 shrink-0" aria-hidden />
          <p className="text-sm font-semibold text-slate-900 dark:text-white">Connected</p>
        </div>
      )}
    </div>
  );
}

export default NetworkStatus;
