import { useState, useEffect, useCallback } from "react";
import API from "../api/api";

// Shared fetch for the Specialization/Hospital master lists used by both
// AddDoctor.jsx and AdminDashboard.jsx's EditDoctorPanel, so the two forms
// can't drift out of sync with each other or with the backend's active list.
export default function useMasterLists() {
  const [specializations, setSpecializations] = useState([]);
  const [hospitals, setHospitals] = useState([]);
  const [loadingLists, setLoadingLists] = useState(true);

  const reload = useCallback(async () => {
    const [specRes, hospRes] = await Promise.all([
      API.get("/admin/specializations"),
      API.get("/admin/hospitals"),
    ]);
    setSpecializations(specRes.data.specializations || []);
    setHospitals(hospRes.data.hospitals || []);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await reload();
      } finally {
        if (!cancelled) setLoadingLists(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  return { specializations, hospitals, loadingLists, reloadLists: reload };
}
