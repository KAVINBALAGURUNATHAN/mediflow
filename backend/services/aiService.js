// AI-assisted symptom -> specialization matching. This is the ONLY AI
// feature anywhere in this app, scoped to the public "Find Doctors" page
// helping patients who don't know medical terminology find the right
// specialist - it has no involvement in booking, queue, or dashboard logic,
// and nothing else should ever import this file.
//
// Uses native fetch (Node 18+) - no SDK dependency added for a single
// classification call.

// process.env.OPEN_API_KEY (missing the "AI") is what's actually set in
// this project's .env, and its "sk-proj-..." prefix confirms it's an
// OpenAI key just under a mistyped name - not touching .env per
// instructions, so this checks both spellings rather than silently running
// in stub mode despite a real key already being configured.
const OPENAI_KEY = process.env.OPENAI_API_KEY || process.env.OPEN_API_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
// Groq: OpenAI-compatible chat-completions API, free tier, no billing
// required. It used to be checked first (the earlier OpenAI key had no
// quota), but its free tier now rate-limits, so OpenAI is preferred again
// and Groq serves as the fallback when no OpenAI key is set.
const GROQ_KEY = process.env.GROQ_API_KEY;

let warnedStub = false;

function buildPrompt(symptoms, availableSpecializations) {
  return [
    "You are a triage assistant for a hospital appointment platform.",
    "A patient described their symptoms in plain language. From the provided list of specializations that CURRENTLY HAVE AN AVAILABLE DOCTOR, pick the one that best matches their symptoms.",
    "",
    `Patient's symptoms: "${symptoms}"`,
    "",
    "Available specializations (choose one, verbatim, exactly as written):",
    availableSpecializations.map((s) => `- ${s}`).join("\n"),
    "",
    "Set \"confidence\" to \"low\" if the symptoms don't actually fit any of these specializations well - " +
      "do NOT invent a stretched medical justification just to force a fit into the list. " +
      "It is only \"high\" if this is a genuinely sound match a real triage nurse would make.",
    "",
    "Respond with ONLY a JSON object, no other text, in exactly this shape:",
    '{"specialization": "<one value from the list above, verbatim>", "reasoning": "<one short sentence explaining why>", "confidence": "high" | "low"}',
  ].join("\n");
}

// Pulls the response apart defensively - models sometimes wrap JSON in
// prose or code fences despite instructions not to.
function parseModelResponse(text) {
  if (!text || typeof text !== "string") {
    throw new Error("AI response was empty");
  }

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  const jsonText = jsonMatch ? jsonMatch[0] : text;

  let parsed;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("AI response was not valid JSON");
  }

  if (!parsed || typeof parsed.specialization !== "string") {
    throw new Error("AI response did not include a specialization");
  }

  return {
    specialization: parsed.specialization.trim(),
    reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning.trim() : "",
    // Defaults to "high" only when the model didn't include the field at
    // all (e.g. an older/weaker model ignoring the instruction) - anything
    // it explicitly marked "low" must stay "low", never get upgraded.
    confidence: parsed.confidence === "low" ? "low" : "high",
  };
}

async function callGroq(prompt) {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${GROQ_KEY}`,
    },
    body: JSON.stringify({
      // llama-3.3-70b-versatile was retired by Groq and now 404s with
      // "model does not exist" - that, not a rate limit, was the Groq
      // failure being seen. Current model, confirmed against the live
      // /v1/models list for this key.
      model: "openai/gpt-oss-20b",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Groq API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function callOpenAI(prompt) {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function callAnthropic(prompt) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-3-5-haiku-20241022",
      max_tokens: 300,
      temperature: 0,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text;
}

/**
 * Classifies plain-language patient symptoms into exactly one of the given
 * available specializations.
 * @param {string} symptoms
 * @param {string[]} availableSpecializations
 * @returns {Promise<{ specialization: string, reasoning: string, confidence: "high"|"low" }>}
 */
async function matchSpecialization(symptoms, availableSpecializations) {
  if (!Array.isArray(availableSpecializations) || availableSpecializations.length === 0) {
    throw new Error("No available specializations were provided");
  }

  if (!GROQ_KEY && !OPENAI_KEY && !ANTHROPIC_KEY) {
    if (!warnedStub) {
      console.warn(
        "[aiService] No GROQ_API_KEY, OPENAI_API_KEY/OPEN_API_KEY, or ANTHROPIC_API_KEY is set - " +
          "symptom matching is running in STUB mode and will not call a real model."
      );
      warnedStub = true;
    }

    return {
      specialization: availableSpecializations[0] || null,
      reasoning: "[STUB] Add an API key to enable real symptom matching.",
      confidence: "low",
    };
  }

  const prompt = buildPrompt(symptoms, availableSpecializations);

  // Try each configured provider in turn rather than committing to one.
  // Previously the first provider with a key present was the only one
  // attempted, so a single account problem took the whole feature down -
  // exactly what happened when the OpenAI key returned 429 insufficient_quota
  // and when Groq's pinned model was retired. Order puts OpenAI first because
  // that is the key most recently supplied; Groq's free tier is the reliable
  // fallback.
  const providers = [
    OPENAI_KEY && { name: "openai", call: callOpenAI },
    GROQ_KEY && { name: "groq", call: callGroq },
    ANTHROPIC_KEY && { name: "anthropic", call: callAnthropic },
  ].filter(Boolean);

  let raw = null;
  const failures = [];

  for (const provider of providers) {
    try {
      raw = await provider.call(prompt);
      if (raw) break;
      failures.push(`${provider.name}: empty response`);
    } catch (error) {
      // Log and move on - a quota, model-retired or transient network error
      // on one provider should not deny the patient a suggestion when
      // another is configured and healthy.
      failures.push(`${provider.name}: ${error.message}`);
      console.warn(`[aiService] ${provider.name} failed, trying next:`, error.message);
    }
  }

  if (!raw) {
    throw new Error(`All AI providers failed - ${failures.join(" | ")}`);
  }

  const result = parseModelResponse(raw);

  // Never pass along a suggestion that isn't one of the real, available
  // specializations - a hallucinated or malformed value here would send a
  // patient looking for a doctor type that doesn't exist in this system.
  if (!availableSpecializations.includes(result.specialization)) {
    throw new Error(
      `AI suggested a specialization ("${result.specialization}") that is not in the available list`
    );
  }

  return result;
}

module.exports = { matchSpecialization };
