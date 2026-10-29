const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// Two gaps found in a manual security review, both fixed here:
//
//   1. Nurse and lab-technician login had NO rate limiting at all, while
//      every other role (doctor, admin, receptionist, patient) did. A
//      password-guessing script could hit /nurse/login or
//      /lab-technician/login without ever being throttled.
//   2. helmet() was not installed - no HSTS, no X-Content-Type-Options, no
//      X-Frame-Options on any response.
//
// Unique port across the suite: `node --test` runs files in parallel, and a
// shared port means whichever suite finishes first kills the server the
// other is still talking to.
const PORT = 5096;
const BASE = `http://localhost:${PORT}`;

let child;

async function login(pathname, body) {
  return fetch(BASE + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("security hardening", () => {
  before(async () => {
    child = spawn(process.execPath, [path.join(__dirname, "..", "server.js")], {
      env: { ...process.env, PORT: String(PORT) },
      stdio: "ignore",
    });

    for (let i = 0; i < 60; i++) {
      try {
        await fetch(BASE + "/consultation-time");
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 500));
      }
    }

    throw new Error("the security hardening test server did not start");
  });

  after(() => {
    if (child) child.kill();
  });

  // helmet's defaults, checked as headers on the wire rather than assumed
  // from the middleware being present in the file.
  test("responses carry baseline security headers", async () => {
    const res = await fetch(BASE + "/consultation-time");

    assert.ok(
      res.headers.get("x-content-type-options"),
      "X-Content-Type-Options must be set"
    );
    assert.ok(
      res.headers.get("strict-transport-security"),
      "Strict-Transport-Security must be set"
    );

    // Deliberately allowed cross-origin: the frontend lives on a different
    // origin (Vercel) from this API (Render), so the DEFAULT "same-origin"
    // policy would silently break every fetch() from the real app.
    assert.equal(
      res.headers.get("cross-origin-resource-policy"),
      "cross-origin",
      "the API must stay readable by the cross-origin frontend"
    );
  });

  // Nurse and lab-technician logins, hit repeatedly with a wrong password.
  // Both must start refusing before the shared limiter's ceiling (20 in 15
  // minutes) is reached - proving the route is actually covered, not just
  // that some limiter somewhere eventually answers.
  for (const pathname of ["/nurse/login", "/lab-technician/login"]) {
    test(`${pathname} throttles repeated attempts`, async () => {
      let sawThrottle = false;

      for (let i = 0; i < 21; i++) {
        const res = await login(pathname, {
          email: "nobody@example.invalid",
          password: "wrong-password",
        });

        if (res.status === 429) {
          sawThrottle = true;
          break;
        }

        // Every response before the limiter trips must be a normal auth
        // failure, not a crash - proves the limiter is what stopped it,
        // not an unrelated error.
        assert.ok(
          [400, 401, 404].includes(res.status),
          `unexpected status ${res.status} from ${pathname}`
        );
      }

      assert.ok(
        sawThrottle,
        `${pathname} must start returning 429 before 21 attempts - it has no rate limiter`
      );
    });
  }
});
