import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "motion/react";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";
import healthPackages from "../data/healthPackages";
import { useBranch } from "../context/BranchContext";
import { IMAGES, packageImage } from "../constants/publicImages";

const EASE = [0.16, 1, 0.3, 1];

// Static/demo package listing - there is no "packages" collection or
// booking flow in the backend, so "Book Appointment" here routes into the
// real doctor-booking flow (via /find-branch or straight to /doctors if a
// branch is already selected) rather than faking a package-specific
// confirmation that nothing on the server actually backs.
function HealthPackages() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { branch } = useBranch();

  const handleBook = () => {
    if (branch) {
      navigate("/doctors");
    } else {
      navigate("/find-branch", { state: { from: { pathname: "/doctors", search: "" } } });
    }
  };

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
            Preventive Care
          </p>
          <h1 className="text-3xl sm:text-4xl font-semibold text-[#111827] tracking-tight mb-3">
            Health Packages
          </h1>
          <p className="text-base text-[#6B7280] leading-relaxed mb-8 max-w-2xl">
            Preventive checkup bundles designed around common health needs. Booking connects you with
            the right doctor at your nearest branch.
          </p>

          <div className="relative overflow-hidden rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)]">
            <img
              src={IMAGES.diagnosticsLab.src}
              alt={IMAGES.diagnosticsLab.alt}
              width={1600}
              height={700}
              className="w-full aspect-[16/9] sm:aspect-[16/7] object-cover"
            />
            <div
              aria-hidden
              className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent"
            />
            <p className="absolute bottom-5 left-6 right-6 text-sm sm:text-base font-medium text-white leading-snug max-w-lg">
              Screenings are carried out in our own diagnostics lab at both branches.
            </p>
          </div>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {healthPackages.map((pkg, i) => (
            <motion.div
              key={pkg.id}
              initial={reduceMotion ? false : { opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: Math.min(i, 6) * 0.04, ease: EASE }}
              className="group overflow-hidden bg-white border border-gray-200/70 rounded-2xl flex flex-col hover:shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)] transition-shadow duration-200"
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
              <div className="p-6 flex flex-col flex-1">
                <p className="font-semibold text-[#111827] mb-2">{pkg.name}</p>
                <p className="text-sm text-[#6B7280] leading-relaxed flex-1">{pkg.description}</p>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mt-4 mb-3">
                  Contact for pricing
                </p>
                <button onClick={handleBook} className="btn-primary w-full">
                  Book Appointment
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

export default HealthPackages;
