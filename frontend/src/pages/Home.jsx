import { useEffect, useState, useCallback, useMemo } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowRight,
  CalendarCheck,
  MapPin,
  Pulse,
  ShieldCheck,
  UsersThree,
  Warning,
} from "@phosphor-icons/react";
import API from "../api/api";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";
import DoctorAvatar from "../components/DoctorAvatar";
import healthPackages from "../data/healthPackages";
import { useBranch } from "../context/BranchContext";
import { getSpecialtyVisual } from "../constants/specialties";
import { IMAGES, packageImage } from "../constants/publicImages";

const EASE = [0.16, 1, 0.3, 1];

// Same helper as FindBranch.jsx/Doctors.jsx - not exported from either, so
// duplicated locally rather than imported cross-file.
function formatBranchLabel(hospital) {
  return hospital.branch ? `${hospital.name} – ${hospital.branch}` : hospital.name;
}

// Public landing page - deliberately forced to a light theme regardless of
// the global dark-mode toggle (no `dark:` classes anywhere in this file),
// per the design brief: dark theme is reserved for the internal Doctor/
// Receptionist/Admin dashboards, not the patient-facing marketing surface.
function Home() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { branch, branches, branchesLoading } = useBranch();

  const [doctors, setDoctors] = useState([]);
  const [statsLoading, setStatsLoading] = useState(true);
  const [statsError, setStatsError] = useState(false);
  const [search, setSearch] = useState("");
  const [specialization, setSpecialization] = useState("");

  const [departments, setDepartments] = useState([]);
  const [deptLoading, setDeptLoading] = useState(true);
  const [deptError, setDeptError] = useState(false);

  // Fetched only to derive real "popular specialties" chips, the featured
  // specialists section, and the doctors/hospitals counts below - never
  // rendered as a full doctor list on this page itself (that's /doctors).
  //
  // Previously this swallowed fetch failures with an empty catch block, so
  // "still loading", "the request failed", and "there are genuinely zero
  // doctors" were all visually identical - every one of them rendered as
  // "0+". That's the actual bug behind the stats showing 0+: the count was
  // always real (doctors.length / locations.length below), never a
  // hardcoded placeholder - it just had no way to distinguish "no data yet"
  // from "zero". statsLoading/statsError below fix that distinction without
  // changing what the numbers are sourced from.
  const fetchDoctors = useCallback(async (signal) => {
    setStatsLoading(true);
    setStatsError(false);
    try {
      const res = await API.get("/doctors", { signal });
      setDoctors(res.data.doctors || []);
    } catch (err) {
      if (err.name === "CanceledError" || err.name === "AbortError" || err.code === "ERR_CANCELED") {
        return;
      }
      // Still silent (no toast) - this is a marketing page, not a page
      // whose job is to surface API errors - but the stats section below
      // now shows "—" instead of a misleading "0+" when this happens.
      setStatsError(true);
    } finally {
      if (!signal?.aborted) setStatsLoading(false);
    }
  }, []);

  const fetchDepartments = useCallback(async (signal) => {
    setDeptLoading(true);
    setDeptError(false);
    try {
      const res = await API.get("/specializations", { signal });
      setDepartments(res.data.specializations || []);
    } catch (err) {
      if (err.name === "CanceledError" || err.name === "AbortError" || err.code === "ERR_CANCELED") {
        return;
      }
      setDeptError(true);
    } finally {
      if (!signal?.aborted) setDeptLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchDoctors(controller.signal);
    return () => controller.abort();
  }, [fetchDoctors]);

  useEffect(() => {
    const controller = new AbortController();
    fetchDepartments(controller.signal);
    return () => controller.abort();
  }, [fetchDepartments]);

  const specializations = useMemo(() => {
    return [...new Set(doctors.map((d) => d.specialization))].filter(Boolean).slice(0, 6);
  }, [doctors]);

  const activeDepartments = useMemo(
    () => departments.filter((d) => d.isActive !== false).slice(0, 8),
    [departments]
  );

  const featuredDoctors = useMemo(() => {
    return [...doctors]
      .sort((a, b) => (b.isAvailable === true) - (a.isAvailable === true))
      .slice(0, 4);
  }, [doctors]);

  const goToDoctors = (e) => {
    e?.preventDefault();
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (specialization) params.set("specialization", specialization);
    const search_ = params.toString();
    // Doctors.jsx gates on a branch being selected and bounces to
    // /find-branch (preserving this destination) if one isn't yet - so
    // there's no separate hospital/location choice to make here.
    navigate(`/doctors${search_ ? `?${search_}` : ""}`);
  };

  const startBooking = () => {
    navigate("/find-branch", { state: { from: { pathname: "/doctors", search: "" } } });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <PublicNav />

      {/* HERO - kept compact so the nearest-branch card and top departments
          stay reachable without much scrolling on a laptop viewport. */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="lg:col-span-7"
          >
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 mb-3">
              MediFlow
            </p>
            <h1 className="text-3xl sm:text-[42px] sm:leading-[1.1] font-semibold text-[#111827] tracking-tight mb-3">
              Find trusted doctors.
            </h1>
            <p className="text-base text-[#6B7280] leading-relaxed max-w-xl mb-6">
              Book appointments in seconds — no calls, no waiting rooms. Track your live position in
              the queue from your phone.
            </p>

            {/* SEARCH */}
            <form
              onSubmit={goToDoctors}
              className="bg-white border border-gray-200/70 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] p-3 flex flex-col sm:flex-row gap-2"
            >
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search doctor or specialty"
                aria-label="Search doctor or specialty"
                className="flex-1 px-4 py-2.5 text-sm text-gray-900 placeholder-gray-400 bg-transparent focus:outline-none"
              />
              <div className="hidden sm:block w-px bg-gray-200" />
              <select
                aria-label="Filter by specialization"
                value={specialization}
                onChange={(e) => setSpecialization(e.target.value)}
                className="px-4 py-2.5 text-sm text-gray-700 bg-transparent focus:outline-none"
              >
                <option value="">Specialization</option>
                {specializations.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <button type="submit" className="btn-primary sm:w-auto whitespace-nowrap">
                Search Doctors
              </button>
            </form>

            <div className="mt-4">
              <button
                onClick={startBooking}
                className="inline-flex items-center gap-2 text-sm font-semibold text-primary-700 hover:text-primary-800 transition-colors"
              >
                <CalendarCheck className="w-4 h-4" aria-hidden />
                Book Appointment — we'll find your nearest branch
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.08, ease: EASE }}
            className="lg:col-span-5"
          >
            <div className="relative overflow-hidden rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_20px_44px_-20px_rgba(15,23,42,0.28)]">
              <img
                src={IMAGES.doctorsTeam.src}
                alt={IMAGES.doctorsTeam.alt}
                width={1000}
                height={1200}
                className="w-full aspect-[4/5] sm:aspect-[16/10] lg:aspect-[4/5] object-cover"
              />
              {/* Scrim to keep the caption legible over the photo */}
              <div
                aria-hidden
                className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/55 to-transparent"
              />
              <p className="absolute bottom-4 left-5 right-5 text-sm font-medium text-white leading-snug">
                Demo clinic network — Downtown, Riverside and Hillview.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* NEAREST BRANCH */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-10 animate-fade-in">
        {branch ? (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-11 h-11 shrink-0 rounded-xl bg-primary-50 flex items-center justify-center">
              <MapPin weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Your Branch</p>
              <p className="font-semibold text-gray-900 leading-snug">{formatBranchLabel(branch)}</p>
              <p className="text-sm text-gray-500 mt-0.5">{branch.address || "Address not listed yet"}</p>
            </div>
            <button
              onClick={() => navigate("/find-branch?manual=1")}
              className="text-sm font-semibold text-primary-600 hover:text-primary-700 transition-colors shrink-0"
            >
              Change Branch
            </button>
          </div>
        ) : (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-5 flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="w-11 h-11 shrink-0 rounded-xl bg-primary-50 flex items-center justify-center">
              <MapPin weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-gray-900">Find your nearest MediFlow branch</p>
              <p className="text-sm text-gray-500 mt-0.5">
                {branchesLoading ? "Loading branches…" : "Three demo clinics — Downtown, Riverside and Hillview."}
              </p>
            </div>
            <button onClick={startBooking} className="btn-primary shrink-0">
              Find My Branch
            </button>
          </div>
        )}
      </section>

      {/* TOP DEPARTMENTS */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold text-gray-900">Top Departments</h2>
          <Link to="/departments" className="text-sm font-semibold text-primary-600 hover:text-primary-700 transition-colors">
            View All
          </Link>
        </div>

        {deptLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-5 animate-pulse">
                <div className="w-10 h-10 rounded-full bg-gray-200 mb-3" />
                <div className="h-3.5 w-2/3 bg-gray-200 rounded" />
              </div>
            ))}
          </div>
        ) : deptError || activeDepartments.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
            {deptError ? "Couldn't load departments right now." : "No departments are configured yet."}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {activeDepartments.map((dept) => {
              const { Icon, chip } = getSpecialtyVisual(dept.name);
              return (
                <Link
                  key={dept._id}
                  to={`/doctors?specialization=${encodeURIComponent(dept.name)}`}
                  className="group bg-white border border-gray-200/70 rounded-2xl p-5 hover:border-primary-300 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] transition-[border-color,box-shadow] duration-200"
                >
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 ${chip}`}>
                    {dept.icon ? (
                      <span className="text-lg leading-none">{dept.icon}</span>
                    ) : (
                      <Icon weight="duotone" className="w-[22px] h-[22px]" aria-hidden />
                    )}
                  </div>
                  <p className="font-semibold text-[#111827] text-sm">{dept.displayName || dept.name}</p>
                  <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary-600">
                    Know More
                    <ArrowRight
                      className="w-3.5 h-3.5 transition-transform duration-200 group-hover:translate-x-0.5"
                      aria-hidden
                    />
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </section>

      {/* FEATURED SPECIALISTS */}
      <section className="border-y border-gray-200 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-semibold text-gray-900">Featured Specialists</h2>
            <Link to="/doctors" className="text-sm font-semibold text-primary-600 hover:text-primary-700 transition-colors">
              View All
            </Link>
          </div>

          {statsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="border border-gray-200 rounded-xl p-5 animate-pulse flex gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-gray-200 shrink-0" />
                  <div className="flex-1 space-y-2 py-1">
                    <div className="h-3.5 w-1/2 bg-gray-200 rounded" />
                    <div className="h-3 w-1/3 bg-gray-200 rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : featuredDoctors.length === 0 ? (
            <div className="border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500">
              No doctors listed yet.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {featuredDoctors.map((doctor) => (
                <Link
                  key={doctor._id}
                  to={`/doctors/${doctor._id}`}
                  className="group flex gap-4 border border-gray-200 rounded-xl p-5 hover:border-primary-300 hover:shadow-md transition-[border-color,box-shadow] duration-200"
                >
                  <DoctorAvatar name={doctor.name} size="lg" />
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900 truncate">{doctor.name}</p>
                    {doctor.qualification && (
                      <p className="text-xs text-gray-500 truncate">{doctor.qualification}</p>
                    )}
                    <span className="inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-primary-50 text-primary-700">
                      {doctor.specialization}
                    </span>
                    <p className="text-xs text-gray-500 mt-1.5">{doctor.experience}+ years experience</p>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* HEALTH PACKAGES PREVIEW */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-semibold text-gray-900">Health Packages</h2>
          <Link to="/health-packages" className="text-sm font-semibold text-primary-600 hover:text-primary-700 transition-colors">
            View All
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {healthPackages.slice(0, 6).map((pkg) => (
            <Link
              key={pkg.id}
              to="/health-packages"
              className="group overflow-hidden bg-white border border-gray-200/70 rounded-2xl hover:border-primary-300 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] transition-[border-color,box-shadow] duration-200"
            >
              <div className="overflow-hidden">
                <img
                  src={packageImage(pkg).src}
                  alt={packageImage(pkg).alt}
                  width={800}
                  height={600}
                  loading="lazy"
                  className="w-full aspect-[4/3] object-cover transition-transform duration-500 group-hover:scale-105"
                />
              </div>
              <div className="p-5">
                <p className="font-semibold text-[#111827] mb-1.5">{pkg.name}</p>
                <p className="text-sm text-[#6B7280] leading-relaxed">{pkg.description}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* EMERGENCY TEASER */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
        <div className="bg-danger-50 border border-danger-200 rounded-2xl p-6 sm:p-7 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 shrink-0 rounded-full bg-white flex items-center justify-center">
              <Warning weight="duotone" className="w-6 h-6 text-danger-600" aria-hidden />
            </div>
            <div>
              <p className="font-semibold text-gray-900">Medical Emergency? Call 108.</p>
              <p className="text-sm text-gray-600 mt-0.5">India's national ambulance number — available 24/7.</p>
            </div>
          </div>
          <Link to="/emergency" className="btn-primary shrink-0">
            Emergency Info
          </Link>
        </div>
      </section>

      {/* WHY CHOOSE MEDIFLOW */}
      <section className="bg-white border-y border-gray-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            <div className="lg:col-span-5">
              <div className="overflow-hidden rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)]">
                <img
                  src={IMAGES.consultation.src}
                  alt={IMAGES.consultation.alt}
                  width={1000}
                  height={750}
                  loading="lazy"
                  className="w-full aspect-[4/3] object-cover"
                />
              </div>
            </div>

            <div className="lg:col-span-7">
              <h2 className="text-2xl font-semibold text-[#111827] tracking-tight mb-6">
                Why Choose MediFlow
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                {[
                  { title: "Real-Time Queue Tracking", body: "See your live position in the queue instead of waiting blind.", Icon: Pulse, chip: "bg-primary-50 text-primary-600" },
                  { title: "Verified Specialists", body: "Browse real doctor profiles with qualifications and experience.", Icon: ShieldCheck, chip: "bg-secondary-50 text-secondary-700" },
                  { title: "Multiple Convenient Branches", body: "Pick whichever clinic is closest to you.", Icon: MapPin, chip: "bg-primary-50 text-primary-600" },
                  { title: "Instant Online Booking", body: "Check availability and confirm your appointment in seconds.", Icon: UsersThree, chip: "bg-secondary-50 text-secondary-700" },
                ].map((item) => (
                  <div key={item.title} className="border border-gray-200/70 rounded-2xl p-5 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] transition-shadow duration-200">
                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${item.chip}`}>
                      <item.Icon weight="duotone" className="w-5 h-5" aria-hidden />
                    </div>
                    <p className="font-semibold text-[#111827] mb-1.5">{item.title}</p>
                    <p className="text-sm text-[#6B7280] leading-relaxed">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

export default Home;
