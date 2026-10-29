import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation, useSearchParams } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Geolocation } from "@capacitor/geolocation";
import API from "../api/api";
import PublicNav from "../components/PublicNav";
import { useBranch } from "../context/BranchContext";

function formatBranchLabel(hospital) {
  return hospital.branch ? `${hospital.name} – ${hospital.branch}` : hospital.name;
}

// Entry point for "Book Appointment" - resolves which Queue Cure
// branch (from the `Hospital` collection) the
// patient should be routed into, using only the browser's built-in
// navigator.geolocation API and a Haversine distance calculation done
// server-side (GET /hospitals/nearest) - no Maps API, no paid API, no
// hospital search field anywhere. There is exactly one decision a patient
// ever makes here: which branch. The hospital itself (Queue Cure) is
// a given, never a choice.
//
// Forced light-only (no dark: classes), same convention as Home/Doctors -
// this is part of the public patient booking surface.
function FindBranch() {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { branch, setBranch, branches, branchesLoading } = useBranch();

  const forceManual = searchParams.get("manual") === "1";
  const redirectTarget = location.state?.from
    ? `${location.state.from.pathname}${location.state.from.search || ""}`
    : "/doctors";

  // "Remember the selected branch for future bookings": if a branch is
  // already stored and the patient isn't explicitly here to change it,
  // don't re-ask - go straight back to where they were headed.
  useEffect(() => {
    if (branch && !forceManual) {
      navigate(redirectTarget, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [stage, setStage] = useState(forceManual ? "manual" : "prompt");
  const [nearest, setNearest] = useState(null);
  const [selectedManual, setSelectedManual] = useState("");

  // `navigator.geolocation` exists inside the Capacitor WebView too, so
  // feature-detecting it says nothing about whether location actually works
  // there: without the native plugin nothing ever asks Android for the
  // runtime permission, so every call fails. The native path below goes
  // through the plugin, which requests the permission properly.
  const isNative = Capacitor.isNativePlatform();
  const geolocationSupported =
    isNative || (typeof navigator !== "undefined" && "geolocation" in navigator);

  const resolveNearest = useCallback(async (latitude, longitude) => {
    try {
      const res = await API.get("/hospitals/nearest", {
        params: { lat: latitude, lng: longitude },
      });
      setNearest(res.data.nearest);
      setStage("resolved");
    } catch {
      // Nearest-branch lookup failed (e.g. no branches have coordinates
      // yet) - fall back to letting the patient pick manually rather
      // than blocking booking entirely.
      setStage("manual");
    }
  }, []);

  const shareLocation = useCallback(async () => {
    if (!geolocationSupported) {
      setStage("manual");
      return;
    }

    setStage("locating");

    // Matches the previous web behaviour: a 10s ceiling so a patient is never
    // stuck on the spinner, and a 5min cache so re-entering this page doesn't
    // re-prompt the GPS.
    const options = { enableHighAccuracy: true, timeout: 10000, maximumAge: 300000 };

    if (isNative) {
      try {
        const status = await Geolocation.requestPermissions({
          permissions: ["location"],
        });
        if (status.location === "denied") {
          setStage("manual");
          return;
        }
        const position = await Geolocation.getCurrentPosition(options);
        await resolveNearest(position.coords.latitude, position.coords.longitude);
      } catch {
        // Denied, timed out, or GPS unavailable - same fallback as the web.
        setStage("manual");
      }
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => resolveNearest(position.coords.latitude, position.coords.longitude),
      () => {
        // Permission denied, timed out, or position unavailable - never
        // block booking, just fall back to the manual list.
        setStage("manual");
      },
      options
    );
  }, [geolocationSupported, isNative, resolveNearest]);

  const confirmBranch = (hospital) => {
    setBranch(hospital);
    navigate(redirectTarget, { replace: true });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC]">
      <PublicNav />

      <div className="max-w-md mx-auto px-4 pt-16 pb-12">
        {stage === "prompt" && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-7 text-center">
            <div className="w-12 h-12 mx-auto rounded-full bg-primary-50 flex items-center justify-center mb-4">
              <svg className="w-6 h-6 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-gray-900 mb-1.5">
              Allow Queue Cure to access your location?
            </h1>
            <p className="text-sm text-gray-500 mb-6">
              We'll use it to automatically find your nearest Queue Cure branch.
            </p>
            <div className="space-y-2.5">
              <button onClick={shareLocation} className="btn-primary w-full">
                Share my location
              </button>
              <button
                onClick={() => setStage("manual")}
                className="w-full py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                Choose branch manually
              </button>
            </div>
          </div>
        )}

        {stage === "locating" && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-10 text-center">
            <div className="w-8 h-8 mx-auto border-[3px] border-gray-200 border-t-primary-600 rounded-full animate-spin mb-4" />
            <p className="text-sm text-gray-500">Finding your nearest branch…</p>
          </div>
        )}

        {stage === "resolved" && nearest && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-7">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              Your nearest branch
            </p>

            <div className="flex items-start gap-3 mb-5">
              <div className="w-11 h-11 shrink-0 rounded-xl bg-primary-50 flex items-center justify-center">
                <svg className="w-5 h-5 text-primary-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2M5 21H3m4-14h6m-6 4h6m-6 4h6" />
                </svg>
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-gray-900 leading-snug">{formatBranchLabel(nearest)}</p>
                <p className="text-sm text-gray-500 mt-0.5">
                  {nearest.distanceKm} km away · Estimated travel {nearest.estimatedTravelMinutes} min
                </p>
              </div>
            </div>

            <div className="space-y-2.5">
              <button onClick={() => confirmBranch(nearest)} className="btn-primary w-full">
                Continue
              </button>
              <button
                onClick={() => setStage("manual")}
                className="w-full py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                Choose Another Branch
              </button>
            </div>
          </div>
        )}

        {stage === "manual" && (
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-7">
            <h1 className="text-lg font-semibold text-gray-900 mb-1">
              Choose your preferred branch
            </h1>
            <p className="text-sm text-gray-500 mb-5">
              {geolocationSupported
                ? "You can switch back to automatic detection anytime."
                : "Location detection isn't available on this device."}
            </p>

            {branchesLoading ? (
              <div className="py-6 text-center">
                <div className="w-6 h-6 mx-auto border-[3px] border-gray-200 border-t-primary-600 rounded-full animate-spin" />
              </div>
            ) : branches.length === 0 ? (
              <p className="text-sm text-gray-500 py-4 text-center">No branches are available right now.</p>
            ) : (
              <div className="space-y-2 mb-6">
                {branches.map((hospital) => {
                  const active = selectedManual === hospital._id;
                  return (
                    <label
                      key={hospital._id}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border cursor-pointer transition-colors duration-150 ${
                        active ? "border-primary-500 bg-primary-50/50" : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="radio"
                        name="branch"
                        value={hospital._id}
                        checked={active}
                        onChange={() => setSelectedManual(hospital._id)}
                        className="w-4 h-4 text-primary-600 focus:ring-primary-500"
                      />
                      <span className="text-sm font-medium text-gray-900">{formatBranchLabel(hospital)}</span>
                    </label>
                  );
                })}
              </div>
            )}

            <button
              onClick={() => confirmBranch(branches.find((h) => h._id === selectedManual))}
              disabled={!selectedManual}
              className="btn-primary w-full disabled:opacity-50 disabled:pointer-events-none"
            >
              Continue
            </button>

            {geolocationSupported && (
              <button
                onClick={() => setStage("prompt")}
                className="w-full mt-2.5 py-2.5 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                Use my location instead
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default FindBranch;
