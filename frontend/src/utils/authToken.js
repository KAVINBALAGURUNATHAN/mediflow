// Client-side inspection of the JWTs the backend already issues.
//
// This is NOT a security boundary - the backend re-verifies the signature and
// role on every request, which is what actually protects data. This exists so
// the UI stops rendering a staff shell for someone who has no business seeing
// it: previously each guard only checked that its localStorage key was
// non-empty, so any string let you through, and a stale doctorToken left over
// from an earlier login sat there indefinitely while you browsed as a patient.
//
// No signature check is possible here (the secret is server-side, correctly),
// so we read the claims and trust the backend for enforcement.

// Base64url -> JSON. Returns null on anything malformed rather than throwing,
// so a corrupted token is treated as "not logged in" instead of crashing the
// route.
export function decodeToken(token) {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 3) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isExpired(claims) {
  if (!claims?.exp) return false; // no exp claim - let the backend decide
  return claims.exp * 1000 <= Date.now();
}

// True only for a well-formed, unexpired token whose role matches.
export function hasValidRole(token, expectedRole) {
  const claims = decodeToken(token);
  if (!claims) return false;
  if (isExpired(claims)) return false;
  return claims.role === expectedRole;
}

// Clears one role's session. Used when a guard rejects a token so the dead
// credential doesn't linger and keep failing on every later navigation.
export function clearSession(tokenKey, userKey) {
  try {
    localStorage.removeItem(tokenKey);
    if (userKey) localStorage.removeItem(userKey);
  } catch {
    // Private-mode / storage-disabled browsers: nothing to clear.
  }
}
