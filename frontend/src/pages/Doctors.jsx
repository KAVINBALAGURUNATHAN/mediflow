import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { useSearchParams, useNavigate, useLocation } from "react-router-dom";
import { MagnifyingGlass, MapPin } from "@phosphor-icons/react";
import { getSpecialtyVisual } from "../constants/specialties";
import API from "../api/api";
import { useToast } from "../context/ToastContext";
import { useBranch } from "../context/BranchContext";
import DoctorListItem from "../components/DoctorListItem";
import DoctorFiltersSidebar from "../components/DoctorFiltersSidebar";
import PublicNav from "../components/PublicNav";
import SymptomMatcher from "../components/SymptomMatcher";

// Same one-liner as FindBranch.jsx's local formatBranchLabel - not exported
// from that file, so duplicated here rather than imported cross-file.
function formatBranchLabel(hospital) {
  return hospital.branch ? `${hospital.name} – ${hospital.branch}` : hospital.name;
}

const DEFAULT_FILTERS = {
  specialization: "all",
  minExperience: "0",
  maxFee: "0",
  availableOnly: false,
};

// Public doctor directory - deliberately forced to a light theme (no
// `dark:` classes anywhere in this file or its DoctorListItem/
// DoctorFiltersSidebar/DoctorAvatar children), per the design brief:
// dark theme is reserved for the internal Doctor/Receptionist/Admin
// dashboards, not this public patient-facing surface.
function Doctors() {
  const toast = useToast();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { branch } = useBranch();

  const toastRef = useRef(toast);
  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Seeded once from the URL - lets Home.jsx's search bar hand off
  // search/specialization without the two pages sharing state.
  const [searchTerm, setSearchTerm] = useState(() => searchParams.get("search") || "");
  const [filters, setFilters] = useState(() => ({
    ...DEFAULT_FILTERS,
    specialization: searchParams.get("specialization") || "all",
  }));

  // Patients never search hospitals and doctors must never mix across
  // branches - bounce to /find-branch (preserving this destination) if no
  // branch has been resolved/chosen yet.
  useEffect(() => {
    if (!branch) {
      navigate("/find-branch", {
        replace: true,
        state: { from: { pathname: location.pathname, search: location.search } },
      });
    }
  }, [branch, navigate, location.pathname, location.search]);

  const fetchDoctors = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const res = await API.get("/doctors", { signal, params: { hospitalId: branch._id } });
      setDoctors(res.data?.doctors || []);
    } catch (err) {
      if (
        err.name === "CanceledError" ||
        err.name === "AbortError" ||
        err.code === "ERR_CANCELED"
      ) {
        return;
      }

      const msg = err.response?.data?.message || "Failed to load doctors.";
      setError(msg);
      toastRef.current?.error(msg);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [branch]);

  const handleRetry = () => {
    const controller = new AbortController();
    fetchDoctors(controller.signal);
  };

  const updateFilters = (patch) => setFilters((prev) => ({ ...prev, ...patch }));

  const clearFilters = () => {
    setSearchTerm("");
    setFilters(DEFAULT_FILTERS);
  };

  useEffect(() => {
    if (!branch) return;
    const controller = new AbortController();
    fetchDoctors(controller.signal);
    return () => controller.abort();
  }, [fetchDoctors, branch]);

  const specializations = useMemo(() => {
    return [...new Set(doctors.map((d) => d.specialization))]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b));
  }, [doctors]);

  const popularSpecialties = specializations.slice(0, 8);

  const filteredAndSortedDoctors = useMemo(() => {
    const searchLower = searchTerm.trim().toLowerCase();
    const minExperience = Number(filters.minExperience);
    const maxFee = Number(filters.maxFee);

    return doctors
      .filter((doctor) => {
        const matchesSearch =
          !searchLower ||
          doctor.name?.toLowerCase().includes(searchLower) ||
          doctor.specialization?.toLowerCase().includes(searchLower) ||
          doctor.location?.toLowerCase().includes(searchLower);
        const matchesSpecialization =
          filters.specialization === "all" || doctor.specialization === filters.specialization;
        const matchesExperience = (doctor.experience || 0) >= minExperience;
        const matchesFee = maxFee === 0 || (doctor.consultationFee || 0) <= maxFee;
        const matchesAvailability = !filters.availableOnly || doctor.isAvailable;

        return (
          matchesSearch &&
          matchesSpecialization &&
          matchesExperience &&
          matchesFee &&
          matchesAvailability
        );
      })
      .sort((a, b) => {
        if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;
        return (a.name || "").localeCompare(b.name || "");
      });
  }, [doctors, searchTerm, filters]);

  const hasActiveFilters =
    searchTerm !== "" ||
    filters.specialization !== "all" ||
    filters.minExperience !== "0" ||
    filters.maxFee !== "0" ||
    filters.availableOnly;

  if (!branch) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <PublicNav />
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-primary-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Finding your branch...</p>
        </div>
      </div>
    );
  }

  if (error)
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <PublicNav />
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <p className="text-red-600 font-medium mb-4">{error}</p>
          <button onClick={handleRetry} className="btn-primary px-6 py-2">
            Try Again
          </button>
        </div>
      </div>
    );

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC]">
        <PublicNav />
        <div className="flex flex-col items-center justify-center gap-3 py-24">
          <div className="w-8 h-8 border-[3px] border-gray-200 border-t-primary-600 rounded-full animate-spin" />
          <p className="text-sm text-gray-500">Fetching available doctors...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <PublicNav />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-8 pb-12">
        {/* TOP: search + popular specialties */}
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900 mb-1">Find a Doctor</h1>
          <p className="text-sm text-gray-500 mb-3">Search by name or specialty</p>

          {branch && (
            <div className="flex items-center gap-2 text-sm text-gray-600 mb-4">
              <MapPin weight="duotone" className="w-4 h-4 text-primary-600" aria-hidden />
              <span className="font-medium text-gray-900">{formatBranchLabel(branch)}</span>
              <button
                onClick={() =>
                  navigate("/find-branch?manual=1", {
                    state: { from: { pathname: location.pathname, search: location.search } },
                  })
                }
                className="text-primary-600 hover:text-primary-700 font-medium"
              >
                Change Branch
              </button>
            </div>
          )}

          <div className="relative mb-4">
            <MagnifyingGlass className="w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 text-gray-500" aria-hidden />
            <input
              aria-label="Search doctors"
              type="text"
              placeholder="Search by doctor name or specialty..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-11 pr-4 py-3.5 text-base text-gray-900 placeholder-gray-400 bg-white border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition-colors"
            />
          </div>

          <SymptomMatcher onApplySpecialization={(spec) => updateFilters({ specialization: spec })} />

          {popularSpecialties.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {popularSpecialties.map((spec) => {
                const active = filters.specialization === spec;
                const { Icon, chip } = getSpecialtyVisual(spec);
                return (
                  <button
                    key={spec}
                    onClick={() => updateFilters({ specialization: active ? "all" : spec })}
                    className={`inline-flex items-center gap-1.5 pl-2 pr-3.5 py-1.5 rounded-full text-xs font-medium border transition-colors duration-150 ${
                      active
                        ? "bg-primary-600 border-primary-600 text-white"
                        : "bg-white border-gray-200 text-gray-600 hover:border-primary-400"
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full flex items-center justify-center ${
                        active ? "bg-white/20 text-white" : chip
                      }`}
                    >
                      <Icon weight="duotone" className="w-3.5 h-3.5" aria-hidden />
                    </span>
                    {spec}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Filters sidebar + results */}
        <div className="flex flex-col lg:flex-row gap-6">
          <DoctorFiltersSidebar
            specializations={specializations}
            filters={filters}
            onChange={updateFilters}
            onClear={clearFilters}
            hasActiveFilters={hasActiveFilters}
            resultCount={filteredAndSortedDoctors.length}
          />

          <div className="flex-1 min-w-0">
            {filteredAndSortedDoctors.length === 0 ? (
              <div className="bg-white border border-gray-200 p-12 text-center rounded-2xl">
                <h3 className="text-xl font-semibold text-gray-900">No doctors found</h3>
                <p className="text-gray-500 mt-2">Try adjusting your search or filters.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {filteredAndSortedDoctors.map((doctor) => (
                  <DoctorListItem key={doctor._id} doctor={doctor} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default Doctors;
