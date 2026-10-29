import { createContext, useContext, useState, useEffect, useCallback } from "react";
import API from "../api/api";

const BranchContext = createContext(null);
const STORAGE_KEY = "selectedBranch";

// Which MediFlow branch the patient is
// currently using. Persisted to localStorage so it survives reloads and
// future visits, per the "remember the selected branch" requirement.
// MediFlow only ever serves one hospital brand today - this is a branch
// picker, never a hospital search - so the only thing stored is a single
// Hospital document (one row from the `Hospital` collection, each row being
// one branch).
export function BranchProvider({ children }) {
  const [branch, setBranchState] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [branches, setBranches] = useState([]);
  const [branchesLoading, setBranchesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    API.get("/hospitals")
      .then((res) => {
        if (!cancelled) setBranches(res.data?.hospitals || []);
      })
      .catch(() => {
        if (!cancelled) setBranches([]);
      })
      .finally(() => {
        if (!cancelled) setBranchesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setBranch = useCallback((hospital) => {
    setBranchState(hospital);
    try {
      if (hospital) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(hospital));
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage unavailable (private browsing etc.) - branch still
      // works for the current session via React state.
    }
  }, []);

  return (
    <BranchContext.Provider value={{ branch, setBranch, branches, branchesLoading }}>
      {children}
    </BranchContext.Provider>
  );
}

export function useBranch() {
  const ctx = useContext(BranchContext);
  if (!ctx) throw new Error("useBranch must be used within a BranchProvider");
  return ctx;
}
