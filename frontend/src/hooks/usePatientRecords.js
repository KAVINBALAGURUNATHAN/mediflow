import { useState, useEffect } from "react";
import API from "../api/api";
import { useToast } from "../context/ToastContext";

// Same rationale as usePatientData: the prescriptions and lab-results pages
// are the same fetch/loading/toast shape over different endpoints, so they
// share one hook rather than two copies of it. Kept separate from
// usePatientData so those pages don't also refetch the profile and the full
// appointment history they never render.
// `extraKey` is optional and exists for the prescriptions page, which also
// renders the free-text prescriptions written before the structured
// Prescription collection existed. They come back under their own key rather
// than merged into `records` because they have a different shape - unparsed
// text, not a medicine list - and the page renders them differently.
function usePatientRecords(path, key, extraKey = null) {
  const toast = useToast();
  const [records, setRecords] = useState([]);
  const [extra, setExtra] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setLoading(true);
        const res = await API.get(path);
        if (cancelled) return;
        setRecords(res.data[key] || []);
        if (extraKey) setExtra(res.data[extraKey] || []);
      } catch (err) {
        if (!cancelled) toast.error(err.response?.data?.message || "Failed to load your records");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [path, key, extraKey, toast]);

  return { records, extra, loading };
}

export default usePatientRecords;
