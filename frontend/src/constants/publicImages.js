// Local photography for the public patient pages, served from /public/images.
//
// These are hand-picked and visually checked, not pulled from a random stock
// service. An earlier version used picsum.photos with descriptive seeds, but
// the seed there only picks *which* random photo you get - the pages ended up
// showing beaches, forests, a city skyline, and a woman on a bicycle.
//
// All photos are from Pexels (free for commercial use, no attribution),
// screened so that: the subject is genuinely clinical, no hospital's
// branding is visible, and nothing is distressing (no trauma or
// resuscitation scenes).
//
// Bundled locally rather than hot-linked so they never depend on a
// third-party CDN staying up.
//
// There is deliberately no doctor-portrait helper: the Doctor model has no
// photo field (see DoctorAvatar.jsx), and putting a stock face next to a
// real, named doctor would misrepresent an actual person.

export const IMAGES = {
  // Hero image for Home/Departments - reuses the care-team photo.
  doctorsTeam: {
    src: "/images/care-team.jpg",
    alt: "Doctor in scrubs with a stethoscope reviewing patient notes",
  },
  consultation: {
    src: "/images/consultation.jpg",
    alt: "Doctor examining an elderly patient with a stethoscope during a consultation",
  },
  waitingRoom: {
    src: "/images/waiting-room.jpg",
    alt: "Bright, clean hospital waiting area with seating and a reception counter",
  },
  careTeam: {
    src: "/images/care-team.jpg",
    alt: "Doctor in scrubs with a stethoscope reviewing patient notes",
  },
  emergency: {
    src: "/images/emergency.jpg",
    alt: "Doctor and nurse conferring beside an emergency department sign",
  },
  diagnosticsLab: {
    src: "/images/diagnostics-lab.jpg",
    alt: "Laboratory technician loading a blood sample into a centrifuge",
  },
  wellnessConsult: {
    src: "/images/consultation.jpg",
    alt: "Doctor examining a patient with a stethoscope during a wellness consultation",
  },
  healthScreening: {
    src: "/images/health-screening.jpg",
    alt: "Gloved hands holding a blood sample tube for health screening tests",
  },
};

// Per-specialty photography: screened Pexels images of that specialty's
// actual procedure.
//
// Specialties with no entry here intentionally return null - Departments.jsx
// then renders a tinted panel carrying the specialty icon. That is a real
// design choice, not a missing asset: a stand-in photo that doesn't depict
// the specialty is worse than an honest icon.
const DEPARTMENT_IMAGES = {
  pulmonology: {
    src: "/images/dept/pulmonology.jpg",
    alt: "Doctor examining a chest X-ray on a lightbox",
  },
  ophthalmology: {
    src: "/images/dept/ophthalmology.jpg",
    alt: "Doctor carrying out a vision test on a child",
  },
  ent: {
    src: "/images/dept/ent.jpg",
    alt: "Child having an ear examination with an otoscope",
  },
  neurology: {
    src: "/images/dept/neurology.jpg",
    alt: "Patient undergoing an EEG examination",
  },
  neurosurgery: {
    src: "/images/dept/neurosurgery.jpg",
    alt: "Clinician reviewing a set of brain MRI scans",
  },
  radiology: {
    src: "/images/dept/radiology.jpg",
    alt: "CT scan images displayed on a tablet",
  },
  dermatology: {
    src: "/images/dept/dermatology.jpg",
    alt: "Dermatologist reviewing a magnified skin image on a tablet",
  },
  oncology: {
    src: "/images/dept/oncology.jpg",
    alt: "Doctor supporting a cancer patient and their companion during a consultation",
  },
  anesthesiology: {
    src: "/images/dept/anesthesiology.jpg",
    alt: "Clinician holding an airway mask used to support a patient's breathing",
  },
  anaesthesiology: {
    src: "/images/dept/anesthesiology.jpg",
    alt: "Clinician holding an airway mask used to support a patient's breathing",
  },
  "plastic surgery": {
    src: "/images/dept/plastic-surgery.jpg",
    alt: "Surgical team performing a procedure in an operating theatre",
  },

  // Reuse the general facility photography where it genuinely depicts the
  // specialty, rather than downloading a near-duplicate.
  "emergency medicine": IMAGES.emergency,
  "general medicine": IMAGES.consultation,
  "family medicine": IMAGES.consultation,
  pathology: IMAGES.diagnosticsLab,
};


export function departmentImage(name) {
  if (!name) return null;
  return DEPARTMENT_IMAGES[name.trim().toLowerCase()] || null;
}

// Every package is a screening or diagnostic product, so each maps to the
// clinical image that actually depicts it rather than a decorative photo.
const PACKAGE_IMAGES = {
  "executive-health-checkup": IMAGES.careTeam,
  "womens-wellness": IMAGES.wellnessConsult,
  "senior-citizen-package": IMAGES.consultation,
  "diabetes-screening": IMAGES.healthScreening,
  "heart-checkup": IMAGES.healthScreening,
  "cancer-screening": IMAGES.diagnosticsLab,
};

export function packageImage(pkg) {
  return PACKAGE_IMAGES[pkg?.id] || IMAGES.diagnosticsLab;
}
