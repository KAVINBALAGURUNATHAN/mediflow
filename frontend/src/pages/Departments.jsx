import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight } from "@phosphor-icons/react";
import API from "../api/api";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";
import { getSpecialtyVisual } from "../constants/specialties";
import { IMAGES, departmentImage } from "../constants/publicImages";

const EASE = [0.16, 1, 0.3, 1];

// Full department directory, sourced live from GET /specializations (the
// real 21-specialty master list already seeded in the DB) - never a
// hardcoded list, so this can never drift from what doctors actually get
// tagged with. Forced light-only, same convention as Home/Doctors.
function Departments() {
  const reduceMotion = useReducedMotion();
  const [departments, setDepartments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const fetchDepartments = useCallback(async (signal) => {
    setLoading(true);
    setError(false);
    try {
      const res = await API.get("/specializations", { signal });
      setDepartments(res.data.specializations || []);
    } catch (err) {
      if (err.name === "CanceledError" || err.name === "AbortError" || err.code === "ERR_CANCELED") {
        return;
      }
      setError(true);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchDepartments(controller.signal);
    return () => controller.abort();
  }, [fetchDepartments]);

  const activeDepartments = departments.filter((d) => d.isActive !== false);

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <PublicNav />

      {/* PAGE HEADER */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-10">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10 items-center"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 mb-3">
              Centres of Excellence
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold text-[#111827] tracking-tight mb-3">
              Departments
            </h1>
            <p className="text-base text-[#6B7280] leading-relaxed max-w-xl">
              Browse our specialties and find the right doctor for your needs. Every department is
              staffed by verified specialists across every MediFlow branch.
            </p>
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)]">
            <img
              src={IMAGES.doctorsTeam.src}
              alt={IMAGES.doctorsTeam.alt}
              width={1200}
              height={900}
              loading="lazy"
              className="w-full aspect-[4/3] object-cover"
            />
          </div>
        </motion.div>
      </section>

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200/70 rounded-2xl p-6 animate-pulse">
                <div className="w-12 h-12 rounded-xl bg-gray-200 mb-4" />
                <div className="h-3.5 w-2/3 bg-gray-200 rounded mb-2.5" />
                <div className="h-3 w-full bg-gray-100 rounded" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500">
            Couldn't load departments right now. Please try again later.
          </div>
        ) : activeDepartments.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-10 text-center text-sm text-gray-500">
            No departments are configured yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {activeDepartments.map((dept, i) => {
              const { Icon, chip } = getSpecialtyVisual(dept.name);
              const photo = departmentImage(dept.name);
              return (
                <motion.div
                  key={dept._id}
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: Math.min(i, 8) * 0.03, ease: EASE }}
                >
                  <Link
                    to={`/doctors?specialization=${encodeURIComponent(dept.name)}`}
                    className="group flex h-full flex-col overflow-hidden bg-white border border-gray-200/70 rounded-2xl shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:border-primary-300 hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] transition-[border-color,box-shadow] duration-200"
                  >
                    {/* Every card gets a media block of the same height so the
                        grid stays even. Specialties with a bundled photo
                        use it; the rest get a tinted panel carrying the
                        specialty icon rather than a stand-in photograph. */}
                    {photo ? (
                      <div className="overflow-hidden">
                        <img
                          src={photo.src}
                          alt={photo.alt}
                          width={800}
                          height={600}
                          loading="lazy"
                          className="w-full aspect-[4/3] object-cover transition-transform duration-500 group-hover:scale-105"
                        />
                      </div>
                    ) : (
                      <div
                        aria-hidden
                        className={`w-full aspect-[4/3] flex items-center justify-center ${chip}`}
                      >
                        <Icon
                          weight="duotone"
                          className="w-16 h-16 transition-transform duration-500 group-hover:scale-110"
                        />
                      </div>
                    )}
                    <div className="flex flex-1 flex-col p-6">
                    <div
                      className={`w-12 h-12 rounded-xl flex items-center justify-center mb-4 ${chip}`}
                    >
                      {dept.icon ? (
                        <span className="text-xl leading-none">{dept.icon}</span>
                      ) : (
                        <Icon weight="duotone" className="w-6 h-6" aria-hidden />
                      )}
                    </div>
                    <p className="font-semibold text-[#111827] text-[15px] leading-snug">
                      {dept.displayName || dept.name}
                    </p>
                    {dept.description && (
                      <p className="text-sm text-[#6B7280] mt-1.5 leading-relaxed line-clamp-3">
                        {dept.description}
                      </p>
                    )}
                    <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-primary-600 group-hover:text-primary-700 transition-colors">
                      Know More
                      <ArrowRight
                        className="w-4 h-4 transition-transform duration-200 group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        )}
      </section>

      <PublicFooter />
    </div>
  );
}

export default Departments;
