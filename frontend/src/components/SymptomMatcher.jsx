import { useState } from "react";
import { Lightbulb } from "@phosphor-icons/react";
import API from "../api/api";

// The only AI-powered surface in the app - a one-shot symptom -> specialty
// suggestion (not a chat interface, since the backend only ever returns a
// single suggestion + reasoning, not a conversation). Scoped entirely to
// this page; nothing else calls POST /doctors/suggest-specialization.
function SymptomMatcher({ onApplySpecialization }) {
  const [symptoms, setSymptoms] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (symptoms.trim().length < 5) {
      setError("Describe your symptoms in a bit more detail.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await API.post("/doctors/suggest-specialization", {
        symptoms: symptoms.trim(),
      });
      setResult({
        specialization: res.data.suggestedSpecialization,
        reasoning: res.data.reasoning,
        confidence: res.data.confidence,
      });
    } catch (err) {
      setError(err.response?.data?.message || "Couldn't get a suggestion right now.");
    } finally {
      setLoading(false);
    }
  };

  const isStub = result?.reasoning?.startsWith("[STUB]");
  // "low" means the AI itself flagged that none of the currently-available
  // specializations (i.e. specializations with an actual available doctor)
  // are a good fit for these symptoms - it still has to name one (the
  // booking flow needs a real, existing specialization to filter to), but
  // presenting that pick with the same confident wording as a real match
  // would be dishonest, especially with only a handful of doctors on the
  // platform so far.
  const isLowConfidence = !isStub && result?.confidence === "low";

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-primary-50 text-primary-600 flex items-center justify-center">
          <Lightbulb weight="duotone" className="w-5 h-5" aria-hidden />
        </div>
        <div>
          <p className="font-semibold text-slate-900 text-sm">Not sure which specialist you need?</p>
          <p className="text-xs text-slate-500 mt-0.5">Describe your symptoms and we'll suggest a department.</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={symptoms}
          onChange={(e) => {
            setSymptoms(e.target.value);
            if (error) setError("");
          }}
          placeholder="e.g. persistent headache and blurred vision"
          className="flex-1 w-full h-11 px-3.5 text-sm text-slate-900 placeholder:text-slate-400 bg-white border border-slate-300 rounded-lg focus:border-primary-500 focus:ring-4 focus:ring-primary-500/10 outline-none transition duration-150"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center justify-center h-11 px-5 rounded-full bg-primary-600 text-white text-sm font-semibold hover:bg-primary-700 active:scale-[0.98] transition duration-150 whitespace-nowrap disabled:opacity-60 disabled:pointer-events-none"
        >
          {loading ? "Thinking…" : "Suggest a Specialist"}
        </button>
      </form>

      {error && <p className="text-xs font-medium text-danger-600 mt-2">{error}</p>}

      {result && (
        <div
          className={`mt-4 p-4 rounded-xl border flex flex-col sm:flex-row sm:items-center gap-3 ${
            isLowConfidence || isStub
              ? "bg-warning-50 border-warning-200"
              : "bg-primary-50 border-primary-200"
          }`}
        >
          <div className="flex-1 min-w-0">
            {isStub ? (
              <>
                <p className="text-sm text-slate-700">
                  Closest available option: <span className="font-semibold text-slate-900">{result.specialization}</span>
                </p>
                <p className="text-xs text-warning-700 mt-0.5">
                  AI matching isn't fully configured yet - this is a placeholder, not a real suggestion.
                </p>
              </>
            ) : isLowConfidence ? (
              <>
                <p className="text-sm text-slate-700">
                  We don't have a strong match for these symptoms among currently available specialists.
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Closest available: <span className="font-medium text-slate-700">{result.specialization}</span>
                  {result.reasoning ? ` — ${result.reasoning}` : ""}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-700">
                  We think you may need{" "}
                  <span className="font-semibold text-slate-900">{result.specialization}</span>.
                </p>
                {result.reasoning && <p className="text-xs text-slate-500 mt-0.5">{result.reasoning}</p>}
              </>
            )}
          </div>
          {result.specialization && (
            <button
              onClick={() => onApplySpecialization(result.specialization)}
              className="inline-flex items-center justify-center h-11 px-5 rounded-full text-sm font-semibold bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 active:scale-[0.98] transition duration-150 shrink-0"
            >
              Filter to {result.specialization}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default SymptomMatcher;
