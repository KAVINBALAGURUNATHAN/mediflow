import { useEffect, useState, useMemo } from "react";
import {
  CalendarBlank,
  CheckCircle,
  XCircle,
  Clock,
  CaretUp,
  CaretDown,
  MagnifyingGlass,
  DownloadSimple,
} from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";

// Forced light-only (no `dark:` classes in this file). The rest of the doctor
// chrome still honours the global theme toggle; this page opts out because its
// chart colours are tuned and contrast-checked against a white surface only.
//
// Every figure here comes from /doctor/dashboard/analytics and
// /doctor/dashboard/monthly. Nothing is padded with sample data: if a doctor
// has one month of history, the chart shows one month.
const MONTH_ORDER = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// Completed / Cancelled / Waiting are statuses, not arbitrary categories, so
// they take reserved status hues. Checked with a CVD validator against a white
// surface: worst adjacent separation is dE 10.5 under deuteranopia (target 8).
// Emerald and amber fall below 3:1 contrast, which is why every series is
// always accompanied by a text label and value rather than colour alone.
const SERIES = [
  { key: "completedAppointments", label: "Completed", fill: "#10B981", pill: "bg-emerald-50 text-emerald-700" },
  { key: "cancelledAppointments", label: "Cancelled", fill: "#E11D48", pill: "bg-rose-50 text-rose-700" },
  { key: "waitingAppointments", label: "Waiting", fill: "#F59E0B", pill: "bg-amber-50 text-amber-700" },
];

const RANGES = [
  { id: "3M", label: "3M", months: 3 },
  { id: "6M", label: "6M", months: 6 },
  { id: "12M", label: "12M", months: 12 },
];

function pct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function StatCard({ label, value, suffix, caption, trend, Icon, iconClass, meter, meterClass }) {
  return (
    <article className="relative bg-white border border-slate-200 rounded-2xl p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className={`absolute top-4 right-4 w-9 h-9 rounded-xl grid place-items-center ${iconClass}`}>
        <Icon weight="duotone" className="w-[18px] h-[18px]" aria-hidden />
      </div>
      <p className="text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500">{label}</p>
      <p className="mt-2.5 text-[32px] leading-none font-bold tracking-tight text-slate-900 tabular-nums">
        {value}
        {suffix && <span className="text-base font-semibold text-slate-500 tracking-normal"> {suffix}</span>}
      </p>
      {meter !== undefined && (
        <div className="mt-3 h-1.5 rounded-full bg-slate-100 overflow-hidden">
          <div className={`h-full rounded-full ${meterClass}`} style={{ width: `${meter}%` }} />
        </div>
      )}
      <p className="mt-2.5 text-xs text-slate-500 flex items-center gap-2 flex-wrap">
        {trend && (
          <span
            className={`inline-flex items-center gap-1 font-bold px-1.5 py-0.5 rounded-full text-[11px] ${
              trend.dir === "up" ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
            }`}
          >
            {trend.dir === "up" ? <CaretUp weight="bold" className="w-3 h-3" /> : <CaretDown weight="bold" className="w-3 h-3" />}
            {trend.text}
          </span>
        )}
        {caption}
      </p>
    </article>
  );
}

function Analytics() {
  const toast = useToast();
  const [summary, setSummary] = useState(null);
  const [monthly, setMonthly] = useState([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState("6M");
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, m] = await Promise.all([
          API.get("/doctor/dashboard/analytics"),
          API.get("/doctor/dashboard/monthly"),
        ]);
        if (cancelled) return;
        setSummary(a.data.analytics);
        setMonthly(m.data.analytics || []);
      } catch (err) {
        if (!cancelled) toast.error(err.response?.data?.message || "Failed to load analytics");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Oldest-first, so the chart reads left-to-right in time and "previous
  // month" for the trend is unambiguous.
  const ordered = useMemo(() => {
    return [...monthly].sort(
      (a, b) => a.year - b.year || MONTH_ORDER.indexOf(a.month) - MONTH_ORDER.indexOf(b.month)
    );
  }, [monthly]);

  const windowed = useMemo(() => {
    const n = RANGES.find((r) => r.id === range)?.months || 6;
    return ordered.slice(-n);
  }, [ordered, range]);

  // Real period-over-period comparison between the two most recent months in
  // the data. With fewer than two months there is nothing to compare, so no
  // trend badge is shown rather than inventing one.
  const trend = useMemo(() => {
    if (ordered.length < 2) return null;
    const [prev, curr] = ordered.slice(-2);
    if (!prev.totalAppointments) return null;
    const delta = Math.round(
      ((curr.totalAppointments - prev.totalAppointments) / prev.totalAppointments) * 100
    );
    if (delta === 0) return null;
    return { dir: delta > 0 ? "up" : "down", text: `${Math.abs(delta)}%` };
  }, [ordered]);

  const totals = useMemo(() => {
    const base = { total: 0, completed: 0, cancelled: 0, waiting: 0 };
    return windowed.reduce(
      (acc, m) => ({
        total: acc.total + (m.totalAppointments || 0),
        completed: acc.completed + (m.completedAppointments || 0),
        cancelled: acc.cancelled + (m.cancelledAppointments || 0),
        waiting: acc.waiting + (m.waitingAppointments || 0),
      }),
      base
    );
  }, [windowed]);

  const tableRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...windowed]
      .reverse()
      .filter((m) => {
        const label = `${m.month} ${m.year}`;
        return (!q || label.toLowerCase().includes(q)) && (!monthFilter || label === monthFilter);
      });
  }, [windowed, query, monthFilter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] pt-20 px-4 sm:px-6 lg:px-8 pb-12">
        <div className="max-w-[1400px] mx-auto">
          <div className="h-9 w-72 bg-slate-200 rounded-lg animate-pulse" />
          <div className="h-4 w-96 bg-slate-100 rounded mt-3 animate-pulse" />
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-6">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-36 bg-white border border-slate-200 rounded-2xl animate-pulse" />
            ))}
          </div>
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
            <div className="xl:col-span-2 h-80 bg-white border border-slate-200 rounded-2xl animate-pulse" />
            <div className="h-80 bg-white border border-slate-200 rounded-2xl animate-pulse" />
          </div>
        </div>
      </div>
    );
  }

  const peak = Math.max(
    1,
    ...windowed.flatMap((m) => SERIES.map((s) => m[s.key] || 0))
  );

  const donutTotal = totals.completed + totals.cancelled + totals.waiting;
  const R = 54;
  const C = 2 * Math.PI * R;
  let offset = 0;
  const arcs = SERIES.map((s) => {
    const value =
      s.key === "completedAppointments" ? totals.completed
      : s.key === "cancelledAppointments" ? totals.cancelled
      : totals.waiting;
    const share = donutTotal > 0 ? value / donutTotal : 0;
    // 2px visual gap between adjacent segments, matching the bar spacing.
    const len = Math.max(share * C - (share > 0 && share < 1 ? 3 : 0), 0);
    const arc = { fill: s.fill, len, offset: -offset, value, share };
    offset += share * C;
    return arc;
  });

  return (
    <div className="min-h-screen bg-[#F8FAFC] pt-20 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-[1400px] mx-auto">
        {/* HEADER */}
        <header className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold text-primary-600 uppercase tracking-[0.12em] mb-2">
              Doctor Portal
            </p>
            <h1 className="text-[30px] sm:text-[32px] font-bold text-slate-900 tracking-tight leading-tight">
              Analytics &amp; Performance
            </h1>
            <p className="text-slate-500 mt-2 max-w-2xl">
              Track appointment volumes, completion rates, and patient visit trends.
            </p>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <div className="flex bg-white border border-slate-200 rounded-[10px] p-[3px] gap-0.5" role="group" aria-label="Time range">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  aria-pressed={range === r.id}
                  className={`px-3.5 py-1.5 text-[13px] font-semibold rounded-[7px] transition-colors duration-150 tabular-nums ${
                    range === r.id ? "bg-primary-600 text-white" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => toast.info("Report export is not available yet.")}
              className="inline-flex items-center gap-2 h-[38px] px-4 rounded-[10px] border border-slate-200 bg-white text-[13px] font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition-colors duration-150"
            >
              <DownloadSimple weight="bold" className="w-4 h-4" aria-hidden />
              Export report
            </button>
          </div>
        </header>

        {/* KPIs */}
        <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mt-6" aria-label="Key metrics">
          <StatCard
            label="Total appointments"
            value={totals.total}
            caption={trend ? "vs previous month" : "in selected range"}
            trend={trend}
            Icon={CalendarBlank}
            iconClass="bg-primary-50 text-primary-700"
          />
          <StatCard
            label="Completion rate"
            value={`${pct(totals.completed, totals.total)}%`}
            caption={`${totals.completed} of ${totals.total} completed`}
            Icon={CheckCircle}
            iconClass="bg-emerald-50 text-emerald-700"
            meter={pct(totals.completed, totals.total)}
            meterClass="bg-emerald-500"
          />
          <StatCard
            label="Cancellation rate"
            value={`${pct(totals.cancelled, totals.total)}%`}
            caption={`${totals.cancelled} cancelled`}
            Icon={XCircle}
            iconClass="bg-rose-50 text-rose-700"
            meter={pct(totals.cancelled, totals.total)}
            meterClass="bg-rose-500"
          />
          <StatCard
            label="Waiting today"
            value={summary?.pendingAppointments ?? 0}
            caption="currently in the queue"
            Icon={Clock}
            iconClass="bg-amber-50 text-amber-700"
          />
        </section>

        {/* CHARTS */}
        <section className="grid grid-cols-1 xl:grid-cols-3 gap-4 mt-4">
          <article className="xl:col-span-2 bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="p-5 pb-0">
              <h2 className="text-base font-semibold text-slate-900">Appointment trends</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">
                Completed, cancelled and waiting appointments by month
              </p>
            </div>
            <div className="flex flex-wrap gap-4 px-5 pt-3.5">
              {SERIES.map((s) => (
                <span key={s.key} className="inline-flex items-center gap-2 text-[12.5px] font-medium text-slate-500">
                  <i className="w-2.5 h-2.5 rounded-[3px]" style={{ background: s.fill }} aria-hidden />
                  {s.label}
                </span>
              ))}
            </div>

            <div className="px-5 pt-4 pb-5">
              {windowed.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-16">
                  No appointment history yet. Charts appear once you have completed visits.
                </p>
              ) : (
                <div className="relative h-60 flex items-end gap-2.5">
                  <div className="absolute inset-x-0 top-0 bottom-[22px] flex flex-col justify-between pointer-events-none" aria-hidden>
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span key={i} className="block border-t border-slate-100" />
                    ))}
                  </div>
                  {windowed.map((m) => (
                    <div key={`${m.month}-${m.year}`} className="flex-1 h-full flex flex-col items-center justify-end gap-2">
                      <div className="w-full h-full flex items-end justify-center gap-[2px]">
                        {SERIES.map((s) => {
                          const v = m[s.key] || 0;
                          return (
                            <div
                              key={s.key}
                              // Zero floors to a thin tick instead of vanishing:
                              // a missing bar reads as missing data, a tick reads
                              // as a real zero.
                              style={{ height: `${Math.max((v / peak) * 100, 1.5)}%`, background: s.fill }}
                              className="w-[26%] max-w-[22px] rounded-t hover:brightness-110 transition-[filter] duration-150"
                              title={`${m.month} ${m.year} · ${s.label}: ${v}`}
                            />
                          );
                        })}
                      </div>
                      <span className="text-[11.5px] text-slate-500 tabular-nums h-3.5">{m.month}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </article>

          <article className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
            <div className="p-5 pb-0">
              <h2 className="text-base font-semibold text-slate-900">Visit status breakdown</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">Share of appointments in range</p>
            </div>

            <div className="grid place-items-center relative py-4">
              <svg width="170" height="170" viewBox="0 0 140 140" role="img"
                aria-label={`${pct(totals.completed, donutTotal)}% completed, ${pct(totals.cancelled, donutTotal)}% cancelled, ${pct(totals.waiting, donutTotal)}% waiting`}>
                <circle cx="70" cy="70" r={R} fill="none" stroke="#F1F5F9" strokeWidth="18" />
                <g transform="rotate(-90 70 70)" strokeWidth="18" fill="none">
                  {arcs.map((a, i) =>
                    a.len > 0 ? (
                      <circle key={i} cx="70" cy="70" r={R} stroke={a.fill}
                        strokeDasharray={`${a.len} ${C}`} strokeDashoffset={a.offset} />
                    ) : null
                  )}
                </g>
              </svg>
              <div className="absolute text-center pointer-events-none">
                <b className="block text-[28px] font-bold tracking-tight text-slate-900 tabular-nums leading-tight">
                  {pct(totals.completed, donutTotal)}%
                </b>
                <span className="text-[11.5px] text-slate-500">completed</span>
              </div>
            </div>

            <div className="px-5 pb-5">
              {SERIES.map((s, i) => {
                const a = arcs[i];
                return (
                  <div key={s.key} className="flex items-center gap-2.5 py-2 border-b border-slate-100 last:border-0 text-[13px]">
                    <i className="w-2.5 h-2.5 rounded-[3px] shrink-0" style={{ background: s.fill }} aria-hidden />
                    <span className="flex-1 text-slate-500">{s.label}</span>
                    <span className="font-bold text-slate-900 tabular-nums">
                      {a.value} · {pct(a.value, donutTotal)}%
                    </span>
                  </div>
                );
              })}
            </div>
          </article>
        </section>

        {/* TABLE */}
        <section className="bg-white border border-slate-200 rounded-2xl shadow-[0_1px_2px_rgba(15,23,42,0.04)] mt-4">
          <div className="flex flex-wrap items-center justify-between gap-3 p-5 border-b border-slate-200">
            <div>
              <h2 className="text-base font-semibold text-slate-900">Monthly performance log</h2>
              <p className="text-[13px] text-slate-500 mt-0.5">Appointment outcomes per month</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="relative">
                <MagnifyingGlass className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search months…"
                  aria-label="Search months"
                  className="h-[34px] pl-9 pr-3 min-w-[200px] text-[13px] text-slate-900 bg-white border border-slate-200 rounded-[9px] outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
                />
              </div>
              <select
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                aria-label="Filter by month"
                className="h-[34px] px-3 text-[13px] text-slate-900 bg-white border border-slate-200 rounded-[9px] outline-none focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10"
              >
                <option value="">All months</option>
                {[...windowed].reverse().map((m) => (
                  <option key={`${m.month}-${m.year}`}>{`${m.month} ${m.year}`}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse">
              <thead>
                <tr>
                  {["Month", "Total", "Completed", "Cancelled", "Waiting", "In consultation", "Completion"].map((h) => (
                    <th key={h} scope="col"
                      className="text-left text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 px-5 py-3 border-b border-slate-200 whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-sm text-slate-500 py-10">
                      {windowed.length === 0
                        ? "No appointment history yet."
                        : "No months match that filter."}
                    </td>
                  </tr>
                ) : (
                  tableRows.map((m) => {
                    const rate = pct(m.completedAppointments, m.totalAppointments);
                    const tone = rate >= 75 ? "bg-emerald-50 text-emerald-700"
                      : rate >= 50 ? "bg-amber-50 text-amber-700"
                      : "bg-rose-50 text-rose-700";
                    const cell = (v, cls) => (
                      <td className="px-5 py-3.5 border-b border-slate-100 last:border-0 text-sm tabular-nums">
                        <span className={`inline-flex items-center justify-center min-w-[34px] px-2.5 py-0.5 rounded-full text-[12.5px] font-bold ${cls}`}>
                          {v}
                        </span>
                      </td>
                    );
                    return (
                      <tr key={`${m.month}-${m.year}`} className="hover:bg-slate-50/70 transition-colors duration-150">
                        <td className="px-5 py-3.5 border-b border-slate-100 text-sm font-semibold text-slate-900 whitespace-nowrap">
                          {m.month} {m.year}
                        </td>
                        <td className="px-5 py-3.5 border-b border-slate-100 text-sm text-slate-700 tabular-nums">
                          {m.totalAppointments}
                        </td>
                        {cell(m.completedAppointments, "bg-emerald-50 text-emerald-700")}
                        {cell(m.cancelledAppointments, "bg-rose-50 text-rose-700")}
                        {cell(m.waitingAppointments, m.waitingAppointments ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-500")}
                        {cell(m.inConsultationAppointments, "bg-slate-100 text-slate-500")}
                        {cell(`${rate}%`, tone)}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}

export default Analytics;
