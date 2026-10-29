// Per-specialty icon + chip colour, shared by Home.jsx and Departments.jsx.
// The colour coding is functional categorisation, which is why this is the
// one place outside the primary/secondary accent system using other hues.
//
// Keys match backend/scripts/seedSpecializations.js plus common aliases an
// admin might type. Unmapped names fall back to a neutral Stethoscope chip.
import {
  Heartbeat,
  Brain,
  HeadCircuit,
  Bone,
  Baby,
  Stethoscope,
  Ear,
  Eye,
  Tooth,
  Hand,
  Drop,
  DropHalf,
  Wind,
  Atom,
  Scan,
  Ambulance,
  Users,
  Scissors,
  Syringe,
  GenderFemale,
  Pill,
  Flower,
} from "@phosphor-icons/react";

const NEUTRAL = { Icon: Stethoscope, chip: "bg-gray-100 text-gray-600" };

const SPECIALTY_VISUALS = {
  cardiology: { Icon: Heartbeat, chip: "bg-rose-50 text-rose-600" },
  dermatology: { Icon: Hand, chip: "bg-amber-50 text-amber-600" },
  "general medicine": { Icon: Stethoscope, chip: "bg-sky-50 text-sky-600" },
  orthopedics: { Icon: Bone, chip: "bg-orange-50 text-orange-600" },
  orthopaedics: { Icon: Bone, chip: "bg-orange-50 text-orange-600" },
  neurology: { Icon: Brain, chip: "bg-violet-50 text-violet-600" },
  neurosurgery: { Icon: HeadCircuit, chip: "bg-indigo-50 text-indigo-600" },
  pediatrics: { Icon: Baby, chip: "bg-pink-50 text-pink-600" },
  paediatrics: { Icon: Baby, chip: "bg-pink-50 text-pink-600" },
  gynecology: { Icon: GenderFemale, chip: "bg-fuchsia-50 text-fuchsia-600" },
  gynaecology: { Icon: GenderFemale, chip: "bg-fuchsia-50 text-fuchsia-600" },
  "obstetrics & gynecology": { Icon: GenderFemale, chip: "bg-fuchsia-50 text-fuchsia-600" },
  psychiatry: { Icon: Brain, chip: "bg-purple-50 text-purple-600" },
  ent: { Icon: Ear, chip: "bg-teal-50 text-teal-600" },
  "ent (otolaryngology)": { Icon: Ear, chip: "bg-teal-50 text-teal-600" },
  otolaryngology: { Icon: Ear, chip: "bg-teal-50 text-teal-600" },
  urology: { Icon: Drop, chip: "bg-cyan-50 text-cyan-600" },
  nephrology: { Icon: DropHalf, chip: "bg-blue-50 text-blue-600" },
  pulmonology: { Icon: Wind, chip: "bg-sky-50 text-sky-600" },
  oncology: { Icon: Atom, chip: "bg-lime-50 text-lime-600" },
  radiology: { Icon: Scan, chip: "bg-slate-100 text-slate-600" },
  "emergency medicine": { Icon: Ambulance, chip: "bg-red-50 text-red-600" },
  "family medicine": { Icon: Users, chip: "bg-emerald-50 text-emerald-600" },
  "plastic surgery": { Icon: Scissors, chip: "bg-rose-50 text-rose-500" },
  anesthesiology: { Icon: Syringe, chip: "bg-indigo-50 text-indigo-500" },
  anaesthesiology: { Icon: Syringe, chip: "bg-indigo-50 text-indigo-500" },
  ophthalmology: { Icon: Eye, chip: "bg-blue-50 text-blue-500" },
  dentistry: { Icon: Tooth, chip: "bg-cyan-50 text-cyan-500" },
  dental: { Icon: Tooth, chip: "bg-cyan-50 text-cyan-500" },
  gastroenterology: { Icon: Pill, chip: "bg-amber-50 text-amber-500" },
  endocrinology: { Icon: Flower, chip: "bg-violet-50 text-violet-500" },
  "general surgery": { Icon: Scissors, chip: "bg-teal-50 text-teal-600" },
};

// Case/whitespace-insensitive lookup. Always returns a renderable
// { Icon, chip } pair - never undefined.
export function getSpecialtyVisual(name) {
  if (!name) return NEUTRAL;
  return SPECIALTY_VISUALS[String(name).trim().toLowerCase()] || NEUTRAL;
}

export default SPECIALTY_VISUALS;
