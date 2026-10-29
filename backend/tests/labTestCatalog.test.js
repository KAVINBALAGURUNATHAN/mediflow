const { test, before, after, describe } = require("node:test");
const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const path = require("node:path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const Admin = require("../models/Admin");
const Doctor = require("../models/Doctor");
const LabTest = require("../models/LabTest");

// The lab test catalog. These cover the invariants that make the catalog worth
// having at all - if any of them fail, free-text test names have effectively
// come back:
//
//   - "cbc" can be added beside "CBC"
//   - a test can exist with no parameters, generating an empty result form
//   - one panel can carry the same parameter twice
//   - a non-admin can rewrite clinic-wide configuration
//
// Runs a real server against the real database, on its own port, and removes
// everything it creates. Catalog entries created here are prefixed so they
// can never be confused with the real demo catalog.
const PORT = 5097;
const BASE = `http://localhost:${PORT}`;
const PREFIX = "ZZ Test Panel";

let child;
let admin;
let doctor;

async function req(pathname, { method = "GET", token, body } = {}) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, body: json };
}

const adminToken = () =>
  jwt.sign({ adminId: String(admin._id), role: "admin" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

const doctorToken = () =>
  jwt.sign({ doctorId: String(doctor._id), role: "doctor" }, process.env.JWT_SECRET, {
    expiresIn: "1h",
  });

// A distinct name per call, so one test's leftovers can never make another
// test's create fail with a duplicate-name 409 and look like a real failure.
const uniqueName = () =>
  `${PREFIX} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe("lab test catalog", () => {
  before(async () => {
    await mongoose.connect(process.env.MONGO_URI);

    admin = await Admin.findOne();
    doctor = await Doctor.findOne();

    assert.ok(admin, "the database needs an admin to test with");
    assert.ok(doctor, "the database needs a doctor to test with");

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

    throw new Error("the test server did not start");
  });

  after(async () => {
    await LabTest.deleteMany({ name: new RegExp(`^${PREFIX}`) });

    if (child) child.kill();
    await mongoose.disconnect();
  });

  test("the catalog loads and the demo tests are in it", async () => {
    const res = await req("/admin/lab-tests", { token: adminToken() });

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body.labTests));

    const names = res.body.labTests.map((t) => t.name);

    // Seeded by scripts/seedLabTests.js. If this fails, run it.
    for (const expected of [
      "Complete Blood Count",
      "Blood Glucose",
      "Liver Function Test",
      "Lipid Profile",
      "Thyroid Profile",
    ]) {
      assert.ok(names.includes(expected), `${expected} should be in the catalog`);
    }

    const cbc = res.body.labTests.find((t) => t.name === "Complete Blood Count");
    assert.equal(cbc.shortName, "CBC");
    assert.ok(
      cbc.parameters.some((p) => p.name === "Haemoglobin" && p.unit === "g/dL"),
      "CBC should define Haemoglobin in g/dL"
    );

    const thyroid = res.body.labTests.find((t) => t.name === "Thyroid Profile");
    assert.deepEqual(
      thyroid.parameters.map((p) => p.name),
      ["TSH", "T3", "T4"],
      "the catalog is what a Thyroid result form will be generated from"
    );
  });

  test("an admin can create a test and it persists with its parameters", async () => {
    const name = uniqueName();

    const created = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: {
        name,
        shortName: "ZZT",
        category: "Testing",
        parameters: [
          {
            name: "Widget Count",
            unit: "/µL",
            dataType: "number",
            required: true,
            referenceRange: "1 - 9",
          },
          { name: "Widget Appearance", dataType: "text", required: false },
        ],
      },
    });

    assert.equal(created.status, 201);

    // Read back from the database, not from the response: a controller can
    // echo a body it never actually stored.
    const stored = await LabTest.findOne({ name });
    assert.ok(stored, "the test should persist");
    assert.equal(stored.parameters.length, 2);
    assert.equal(stored.parameters[0].name, "Widget Count");
    assert.equal(stored.parameters[0].referenceRange, "1 - 9");
    assert.equal(stored.parameters[1].dataType, "text");
    assert.equal(stored.parameters[1].required, false);
    assert.equal(stored.isActive, true);
  });

  test("an admin can add a parameter to an existing test", async () => {
    const name = uniqueName();

    const created = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: {
        name,
        parameters: [{ name: "First", unit: "mg/dL" }],
      },
    });

    assert.equal(created.status, 201);
    const id = created.body.labTest._id;

    const updated = await req(`/admin/lab-tests/${id}`, {
      method: "PUT",
      token: adminToken(),
      body: {
        parameters: [
          { name: "First", unit: "mg/dL" },
          { name: "Second", unit: "U/L", referenceRange: "5 - 40" },
        ],
      },
    });

    assert.equal(updated.status, 200);

    const stored = await LabTest.findById(id);
    assert.deepEqual(
      stored.parameters.map((p) => p.name),
      ["First", "Second"]
    );
    assert.equal(stored.parameters[1].referenceRange, "5 - 40");
  });

  test("a duplicate name is refused, case-insensitively", async () => {
    const name = uniqueName();

    const first = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name, parameters: [{ name: "First" }] },
    });
    assert.equal(first.status, 201);

    // The whole point of the catalog: "cbc" must not become a second test
    // alongside "CBC".
    const second = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name: name.toUpperCase(), parameters: [{ name: "First" }] },
    });
    assert.equal(second.status, 409);

    const count = await LabTest.countDocuments({
      name: new RegExp(`^${name}$`, "i"),
    });
    assert.equal(count, 1);
  });

  test("a test with no usable parameters is refused", async () => {
    const empty = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name: uniqueName(), parameters: [] },
    });
    assert.equal(empty.status, 400);

    // Blank rows are how a form sends "I added a row and changed my mind" -
    // they are dropped, which leaves nothing, which is still refused.
    const blank = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name: uniqueName(), parameters: [{ name: "  " }] },
    });
    assert.equal(blank.status, 400);

    const noName = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name: "", parameters: [{ name: "First" }] },
    });
    assert.equal(noName.status, 400);
  });

  test("the same parameter twice on one panel is refused", async () => {
    const res = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: {
        name: uniqueName(),
        parameters: [{ name: "TSH" }, { name: "tsh" }],
      },
    });

    assert.equal(res.status, 400);
  });

  test("retiring a test hides it from the catalog without deleting it", async () => {
    const name = uniqueName();

    const created = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name, parameters: [{ name: "First" }] },
    });
    const id = created.body.labTest._id;

    const retired = await req(`/admin/lab-tests/${id}`, {
      method: "DELETE",
      token: adminToken(),
    });
    assert.equal(retired.status, 200);

    // Still there - results already reported against it must keep their
    // meaning, so it is deactivated rather than removed.
    const stored = await LabTest.findById(id);
    assert.ok(stored, "a retired test must not be deleted");
    assert.equal(stored.isActive, false);

    const active = await req("/admin/lab-tests", { token: adminToken() });
    assert.ok(!active.body.labTests.some((t) => t._id === id));

    const all = await req("/admin/lab-tests?includeInactive=1", {
      token: adminToken(),
    });
    assert.ok(all.body.labTests.some((t) => t._id === id));
  });

  test("a name held by a RETIRED test says so instead of stonewalling", async () => {
    const name = uniqueName();

    const created = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name, parameters: [{ name: "First" }] },
    });
    const id = created.body.labTest._id;

    await req(`/admin/lab-tests/${id}`, { method: "DELETE", token: adminToken() });

    // The clashing test is now invisible in the default catalog listing, so
    // "already exists" on its own leaves the admin staring at a list that does
    // not contain the name the server says is taken.
    const again = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name, parameters: [{ name: "First" }] },
    });

    assert.equal(again.status, 409);
    assert.match(
      again.body.message,
      /retired/i,
      "the message must point the admin at restoring it"
    );

    // An active clash keeps the plain message - there is nothing to restore.
    const activeClash = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name: "complete blood count", parameters: [{ name: "First" }] },
    });

    assert.equal(activeClash.status, 409);
    assert.doesNotMatch(activeClash.body.message, /retired/i);
  });

  test("a non-admin cannot read or write the catalog", async () => {
    const name = uniqueName();

    const created = await req("/admin/lab-tests", {
      method: "POST",
      token: adminToken(),
      body: { name, parameters: [{ name: "First" }] },
    });
    const id = created.body.labTest._id;

    // The catalog is clinic-wide configuration. A doctor reads it in Phase 3
    // through a doctor-prefixed route; the admin one must stay admin-only.
    const doctorRead = await req("/admin/lab-tests", { token: doctorToken() });
    assert.equal(doctorRead.status, 403);

    const doctorWrite = await req(`/admin/lab-tests/${id}`, {
      method: "PUT",
      token: doctorToken(),
      body: { name: "Rewritten by a doctor" },
    });
    assert.equal(doctorWrite.status, 403);

    const anonymous = await req("/admin/lab-tests");
    assert.equal(anonymous.status, 401);

    const stored = await LabTest.findById(id);
    assert.equal(stored.name, name, "the refused write must have changed nothing");
  });
});
