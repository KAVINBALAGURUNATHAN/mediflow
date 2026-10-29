import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  MagnifyingGlass,
  Users,
  CaretLeft,
  CaretRight,
  ArrowLeft,
  X,
} from "@phosphor-icons/react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";

// Registered patients, for admin. Until GET /admin/patients existed nothing
// surfaced the Patient collection to staff at all: /patients/search is
// doctor-only and queries Appointment, so anyone who registered but never
// booked was invisible in every portal.
//
// Access is enforced twice and neither is done here: AdminProtectedRoute
// gates the route on a valid admin token, and adminAuth rejects the request
// server-side. The API instance already attaches the admin token for any
// /admin/ URL, so no token handling belongs in this file.

const TH =
  "text-left text-[11px] font-bold uppercase tracking-[0.07em] text-slate-500 dark:text-slate-400 px-5 py-3 border-b border-slate-200 dark:border-surface-border whitespace-nowrap";
const TD = "px-5 py-3.5 border-b border-slate-100 dark:border-surface-border";

const PAGE_SIZE = 25;

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function AdminPatients() {
  const toast = useToast();

  const [patients, setPatients] = useState([]);
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  // Debounced so a search doesn't fire a request per keystroke.
  const [appliedSearch, setAppliedSearch] = useState("");
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setAppliedSearch(search.trim());
      setPage(1); // a new search always restarts at page 1
    }, 350);

    return () => clearTimeout(debounceRef.current);
  }, [search]);

  const fetchPatients = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: PAGE_SIZE };
      if (appliedSearch) params.search = appliedSearch;

      const res = await API.get("/admin/patients", { params });
      setPatients(res.data.patients || []);
      setTotal(res.data.total || 0);
      setPages(res.data.pages || 1);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load patients");
      setPatients([]);
    } finally {
      setLoading(false);
    }
    // toast is stable from context; excluding it keeps this from refetching
    // on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, appliedSearch]);

  useEffect(() => {
    fetchPatients();
  }, [fetchPatients]);

  const showingFrom = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const showingTo = Math.min(page * PAGE_SIZE, total);

  return (
    <div className="min-h-screen pt-24 px-4 sm:px-6 lg:px-8 pb-12">
      <div className="max-w-6xl mx-auto">
        <Link
          to="/admin-dashboard"
          className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 dark:text-slate-400 hover:text-primary-600 mb-4 transition duration-150"
        >
          <ArrowLeft weight="bold" className="w-4 h-4" aria-hidden />
          Back to dashboard
        </Link>

        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="page-heading mb-2">Registered Patients</h1>
            <p className="page-subheading">
              Everyone with a patient account, including those who have not booked yet
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <div className="w-10 h-10 rounded-xl bg-primary-50 dark:bg-primary-500/10 flex items-center justify-center">
              <Users weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
            </div>
            <div>
              <p className="text-2xl font-bold text-slate-900 dark:text-white font-mono leading-none">
                {total}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-500 mt-1">
                {appliedSearch ? "matching" : "total"}
              </p>
            </div>
          </div>
        </div>

        <div className="relative mb-5">
          <MagnifyingGlass
            weight="bold"
            className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none"
            aria-hidden
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search by name, phone, email or patient ID"
            aria-label="Search patients"
            className="w-full h-11 pl-11 pr-11 rounded-full border border-slate-200 dark:border-surface-border bg-white dark:bg-surface-card text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary-500/40 focus:border-primary-500 transition duration-150"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 w-7 h-7 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition duration-150"
            >
              <X weight="bold" className="w-3.5 h-3.5" aria-hidden />
            </button>
          )}
        </div>

        <div className="card rounded-2xl overflow-hidden">
          {loading && (
            <div className="text-center py-16">
              <div className="w-10 h-10 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
              <p className="text-sm text-slate-600 dark:text-slate-500">Loading patients...</p>
            </div>
          )}

          {!loading && patients.length === 0 && (
            <div className="text-center py-16 px-6">
              <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mx-auto mb-4">
                <Users weight="duotone" className="w-6 h-6 text-slate-400" aria-hidden />
              </div>
              <p className="font-semibold text-slate-900 dark:text-white">
                {appliedSearch ? "No matching patients" : "No patients registered yet"}
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-500 mt-1">
                {appliedSearch
                  ? `Nothing matched "${appliedSearch}". Try a different name, phone or ID.`
                  : "Patients will appear here as soon as they create an account."}
              </p>
            </div>
          )}

          {!loading && patients.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={TH}>Patient ID</th>
                    <th scope="col" className={TH}>Name</th>
                    <th scope="col" className={TH}>Phone</th>
                    <th scope="col" className={TH}>Email</th>
                    <th scope="col" className={TH}>Blood Group</th>
                    <th scope="col" className={TH}>Status</th>
                    <th scope="col" className={TH}>Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {patients.map((patient) => (
                    <tr
                      key={patient._id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/40 transition duration-150"
                    >
                      <td className={`${TD} font-mono text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap`}>
                        {patient.patientId || "—"}
                      </td>
                      <td className={`${TD} font-semibold text-slate-900 dark:text-white`}>
                        {patient.name || "—"}
                      </td>
                      <td className={`${TD} font-mono text-sm text-slate-700 dark:text-slate-300 whitespace-nowrap`}>
                        {patient.phone || "—"}
                      </td>
                      <td className={`${TD} text-sm text-slate-600 dark:text-slate-400 max-w-[220px] truncate`}>
                        {patient.email || "—"}
                      </td>
                      <td className={`${TD} text-sm text-slate-700 dark:text-slate-300`}>
                        {patient.bloodGroup || "—"}
                      </td>
                      <td className={TD}>
                        <span
                          className={
                            patient.isActive === false ? "badge-cancelled" : "badge-completed"
                          }
                        >
                          {patient.isActive === false ? "Inactive" : "Active"}
                        </span>
                      </td>
                      <td className={`${TD} text-sm text-slate-600 dark:text-slate-400 whitespace-nowrap`}>
                        {formatDate(patient.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && total > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-5">
            <p className="text-sm text-slate-500 dark:text-slate-500">
              Showing <span className="font-semibold text-slate-700 dark:text-slate-300">{showingFrom}</span>
              –<span className="font-semibold text-slate-700 dark:text-slate-300">{showingTo}</span> of{" "}
              <span className="font-semibold text-slate-700 dark:text-slate-300">{total}</span>
            </p>

            {pages > 1 && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page <= 1}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium border border-slate-200 dark:border-surface-border text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition duration-150"
                >
                  <CaretLeft weight="bold" className="w-3.5 h-3.5" aria-hidden />
                  Previous
                </button>

                <span className="text-sm text-slate-600 dark:text-slate-400 px-2 tabular-nums">
                  {page} / {pages}
                </span>

                <button
                  type="button"
                  onClick={() => setPage((value) => Math.min(pages, value + 1))}
                  disabled={page >= pages}
                  className="inline-flex items-center gap-1.5 h-9 px-4 rounded-full text-sm font-medium border border-slate-200 dark:border-surface-border text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition duration-150"
                >
                  Next
                  <CaretRight weight="bold" className="w-3.5 h-3.5" aria-hidden />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default AdminPatients;
