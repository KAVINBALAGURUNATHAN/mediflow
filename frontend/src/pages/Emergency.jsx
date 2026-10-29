import { motion, useReducedMotion } from "motion/react";
import { Ambulance, Phone } from "@phosphor-icons/react";
import PublicNav from "../components/PublicNav";
import PublicFooter from "../components/PublicFooter";
import { useBranch } from "../context/BranchContext";
import { IMAGES } from "../constants/publicImages";

const EASE = [0.16, 1, 0.3, 1];

function formatBranchLabel(hospital) {
  return hospital.branch ? `${hospital.name} – ${hospital.branch}` : hospital.name;
}

// 108 is India's real national ambulance number - not invented for this
// app, safe to state directly. Branch phone numbers are read live from the
// real Hospital.phone field and only ever rendered as a tel: link when
// actually set - a wrong or fabricated number here is a genuine safety
// risk, not just a data nitpick, so there is no invented fallback number.
function Emergency() {
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
          className="grid grid-cols-1 lg:grid-cols-2 gap-8 lg:gap-10 items-center mb-10"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-danger-600 mb-3">
              24/7 Emergency Care
            </p>
            <h1 className="text-3xl sm:text-4xl font-semibold text-[#111827] tracking-tight mb-3">
              Emergency Services
            </h1>
            <p className="text-base text-[#6B7280] leading-relaxed max-w-2xl">
              If this is a medical emergency, call for help immediately.
            </p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-gray-200/70 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_12px_32px_-12px_rgba(15,23,42,0.12)]">
            <img
              src={IMAGES.emergency.src}
              alt={IMAGES.emergency.alt}
              width={1200}
              height={800}
              className="w-full aspect-[3/2] object-cover"
            />
          </div>
        </motion.div>

        {/* HOTLINE */}
        <div className="bg-danger-50 border border-danger-200 rounded-2xl p-7 flex flex-col sm:flex-row items-center justify-between gap-5 mb-10">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 shrink-0 rounded-full bg-white flex items-center justify-center">
              <Ambulance weight="duotone" className="w-7 h-7 text-danger-600" aria-hidden />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-600 uppercase tracking-wide">Emergency Hotline</p>
              <p className="text-2xl font-bold text-gray-900">108</p>
              <p className="text-sm text-gray-600">India's national ambulance number — available 24/7.</p>
            </div>
          </div>
          <a href="tel:108" className="btn-primary bg-danger-600 hover:bg-danger-700 shrink-0">
            Call 108
          </a>
        </div>

        {/* BRANCHES */}
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Branch Contact Numbers</h2>
        {branchesLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="bg-white border border-gray-200 rounded-xl p-6 animate-pulse h-24" />
            ))}
          </div>
        ) : branches.length === 0 ? (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-sm text-gray-500 mb-10">
            No branches are configured yet.
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            {branches.map((hospital) => (
              <div key={hospital._id} className="bg-white border border-gray-200/70 rounded-2xl p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
                <p className="font-semibold text-[#111827] mb-1">{formatBranchLabel(hospital)}</p>
                <p className="text-sm text-[#6B7280] mb-3">{hospital.address || "Address not listed yet"}</p>
                {hospital.phone ? (
                  <a href={`tel:${hospital.phone}`} className="inline-flex items-center gap-2 text-sm font-semibold text-primary-600 hover:text-primary-700 transition-colors">
                    <Phone weight="duotone" className="w-4 h-4" aria-hidden />
                    {hospital.phone}
                  </a>
                ) : (
                  <p className="text-sm text-gray-500">Phone not listed yet</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* WHAT TO DO */}
        <h2 className="text-xl font-semibold text-gray-900 mb-4">What To Do In An Emergency</h2>
        <div className="bg-white border border-gray-200/70 rounded-2xl p-6 mb-10 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <ul className="space-y-3 text-sm text-[#6B7280]">
            <li className="flex gap-2.5">
              <span className="text-primary-600 font-semibold">1.</span>
              Call 108 immediately for an ambulance and emergency medical assistance.
            </li>
            <li className="flex gap-2.5">
              <span className="text-primary-600 font-semibold">2.</span>
              If you're able to travel safely, head to your nearest MediFlow branch.
            </li>
            <li className="flex gap-2.5">
              <span className="text-primary-600 font-semibold">3.</span>
              Stay on the line with emergency services and follow their instructions.
            </li>
          </ul>
        </div>

        {/* ER AVAILABILITY - honestly labeled, no fabricated live data */}
        <h2 className="text-xl font-semibold text-gray-900 mb-4">ER Availability</h2>
        <div className="bg-white border border-gray-200/70 rounded-2xl p-6 text-sm text-[#6B7280] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          Live emergency room availability isn't tracked in this system yet. Please call your branch
          or dial 108 for the most accurate, up-to-date information.
        </div>
      </section>

      <PublicFooter />
    </div>
  );
}

export default Emergency;
