// Static/demo content - there is no "package" collection anywhere in the
// backend, so this list is intentionally hand-written rather than fetched.
// No prices are invented here (no pricing field exists on anything in the
// schema) - each package instead carries an honest "Contact for pricing"
// label wherever it's rendered. Shared between Home.jsx's preview grid and
// the full HealthPackages.jsx page so the two never drift apart.
const healthPackages = [
  {
    id: "executive-health-checkup",
    name: "Executive Health Checkup",
    description: "A comprehensive screening covering key health markers for busy professionals.",
  },
  {
    id: "womens-wellness",
    name: "Women's Wellness",
    description: "A focused set of screenings addressing common health needs across a woman's life stages.",
  },
  {
    id: "senior-citizen-package",
    name: "Senior Citizen Package",
    description: "Screenings tailored to the health priorities that matter most as you age.",
  },
  {
    id: "diabetes-screening",
    name: "Diabetes Screening",
    description: "Checks to help identify diabetes risk early, before symptoms appear.",
  },
  {
    id: "heart-checkup",
    name: "Heart Checkup",
    description: "A cardiac-focused screening to assess heart health and risk factors.",
  },
  {
    id: "cancer-screening",
    name: "Cancer Screening",
    description: "Early-detection screenings for some of the most common cancer types.",
  },
];

export default healthPackages;
