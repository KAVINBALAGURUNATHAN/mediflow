import { motion, useReducedMotion } from "motion/react";
import { Buildings, Phone, NavigationArrow } from "@phosphor-icons/react";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";
import { useBranch } from "../context/BranchContext";
import { IMAGES } from "../constants/publicImages";

const EASE = [0.16, 1, 0.3, 1];

function formatBranchLabel(hospital) {
  return hospital.branch ? `${hospital.name} – ${hospital.branch}` : hospital.name;
}

// Address/phone/working-hours all come straight from the real Hospital
// documents (via useBranch()'s branches) - no invented email, map embed,
// or working hours, since none of those exist in the Hospital schema.
function Contact() {
  const reduceMotion = useReducedMotion();
  const { branches, branchesLoading } = useBranch();

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <PublicNav />

      <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-14">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: EASE }}
          className="mb-10"
        >
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary-600 mb-3">
            Get In Touch
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold text-[#111827] tracking-tight mb-3">
            Contact Us
          </h1>
          <p className="text-base text-[#6B7280] leading-relaxed max-w-2xl">
            Reach out to any MediFlow branch directly.
          </p>
        </motion.div>

        {branchesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200/70 rounded-2xl overflow-hidden animate-pulse">
                <div className="w-full aspect-[5/3] bg-gray-200" />
                <div className="p-6 space-y-2.5">
                  <div className="h-4 w-2/3 bg-gray-200 rounded" />
                  <div className="h-3 w-full bg-gray-100 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : branches.length === 0 ? (
          <div className="bg-white border border-gray-200/70 rounded-2xl p-8 text-center text-sm text-[#6B7280] mb-10">
            No branches are configured yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 mb-10">
            {branches.map((hospital) => (
              <div
                key={hospital._id}
                className="group bg-white border border-gray-200/70 rounded-2xl overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] transition-shadow duration-200"
              >
                <div className="overflow-hidden">
                  <img
                    src={IMAGES.waitingRoom.src}
                    alt={IMAGES.waitingRoom.alt}
                    width={1000}
                    height={600}
                    loading="lazy"
                    className="w-full h-[180px] object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <div className="p-6">
                  <div className="flex items-start gap-3 mb-3">
                    <div className="w-10 h-10 shrink-0 rounded-xl bg-primary-50 flex items-center justify-center">
                      <Buildings weight="duotone" className="w-5 h-5 text-primary-600" aria-hidden />
                    </div>
                    <p className="font-semibold text-[#111827] leading-snug pt-2">
                      {formatBranchLabel(hospital)}
                    </p>
                  </div>
                  <p className="text-sm text-[#6B7280]">{hospital.address || "Address not listed yet"}</p>

                  <div className="flex flex-wrap gap-2 mt-4">
                    {hospital.phone ? (
                      <a
                        href={`tel:${hospital.phone.replace(/\s+/g, "")}`}
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150"
                      >
                        <Phone weight="fill" className="w-4 h-4" aria-hidden />
                        Call now
                      </a>
                    ) : (
                      <span className="text-sm text-gray-500">Phone not listed yet</span>
                    )}

                    {/* Coordinates come from the Hospital document (the same
                        ones /hospitals/nearest ranks by), so this opens the
                        real branch location rather than a text search. */}
                    {hospital.latitude != null && hospital.longitude != null && (
                      <a
                        href={`https://www.google.com/maps/dir/?api=1&destination=${hospital.latitude},${hospital.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 h-10 px-4 rounded-full border border-gray-300 text-gray-700 text-sm font-medium hover:bg-gray-50 active:scale-[0.98] transition duration-150"
                      >
                        <NavigationArrow weight="duotone" className="w-4 h-4" aria-hidden />
                        Get directions
                      </a>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* EMERGENCY CALLOUT */}
        <div className="bg-danger-50 border border-danger-200 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-gray-900">Medical Emergency? Call 108.</p>
            <p className="text-sm text-gray-600 mt-0.5">India's national ambulance number — available 24/7.</p>
          </div>
          <a href="tel:108" className="btn-primary bg-danger-600 hover:bg-danger-700 shrink-0">
            Call 108
          </a>
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

export default Contact;
