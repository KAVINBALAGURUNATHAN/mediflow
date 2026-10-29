# MediFlow

MediFlow is a fictional multi-specialty clinic network, built as a portfolio
project. All branch names, addresses and phone numbers are placeholder demo data.

MERN outpatient appointment and clinical queue platform. Six independent
staff roles (doctor, receptionist, nurse, lab technician, admin) plus a
patient portal, a live queue board, and a Waiting/Vacant List for late
arrivals and no-shows.

- **Backend:** Node/Express (CommonJS) + Mongoose/MongoDB Atlas, Socket.IO for
  live queue updates. Deployed on Render.
- **Frontend:** React 18 + Vite (ESM) + Tailwind. Deployed on Vercel.

## Getting started

```bash
# Backend
cd backend
npm install
cp .env.example .env   # fill in your own values — see below
npm run dev             # nodemon, http://localhost:5000

# Frontend, in a second terminal
cd frontend
npm install
cp .env.example .env
npm run dev              # http://localhost:5173
```

To load the demo clinic branches and specialization list:

```bash
cd backend
node scripts/seedDemoBranches.js
node scripts/seedSpecializations.js
```

Both dev servers run on `localhost`; the frontend's `VITE_API_URL` points at
the backend.

### Environment variables

Neither `.env` file is committed. Set your own — nothing here should be
copied from a shared chat or another developer's file; treat each value as
that person's to issue, not yours to inherit.

**`backend/.env`**

| Variable | Purpose |
|---|---|
| `MONGO_URI` | MongoDB Atlas connection string |
| `JWT_SECRET` | Signs every role's auth token — no fallback; auth fails closed if unset |
| `PORT` | Defaults to 5000 |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | Bootstrap admin login |
| `ALLOWED_ORIGINS` | Comma-separated browser origins the API accepts CORS requests from |
| `GOOGLE_CLIENT_ID` | Patient Google sign-in |
| `OPENAI_API_KEY` / `GROQ_API_KEY` | Symptom → specialization matching (tried in order; either can be omitted) |
| `RESEND_API_KEY` / `BREVO_API_KEY` / `SMTP_USER` / `SMTP_PASS` | Outbound mail — Resend preferred, since Render blocks outbound SMTP |
| `MAIL_FROM` | From-address for outgoing mail |
| `APP_URL` | Base URL used in outgoing email links |

**`frontend/.env`**

| Variable | Purpose |
|---|---|
| `VITE_API_URL` | Backend base URL (`http://localhost:5000` in dev) |
| `VITE_GOOGLE_CLIENT_ID` | Patient Google sign-in |

## Project structure

```
backend/
  server.js          # most routes are registered inline here, deliberately
  controllers/        # one per role: doctor, receptionist, nurse, labTechnician, admin, patient
  models/              # Appointment is the core document; most business rules live in its hooks
  middleware/          # one auth middleware per role — no shared "User" model
  utils/                # istDay.js / getISTDayRange.js — IST day-boundary helpers, read before touching dates
  tests/                # node --test; each suite spawns its own server on its own port

frontend/
  src/pages/            # one dashboard per role + the patient portal
  src/components/       # QueueTable, WaitingList, NurseDashboard row cards, etc.
  tests/                 # Playwright, one spec file per workflow area
```

## Running the tests

```bash
cd backend && npm test              # node --test, ~150 tests, suites run in parallel
cd frontend && npx playwright test  # end-to-end, drives a real browser against the real API
cd frontend && npm run build        # production build must succeed with zero errors
```

**The test suites run against the database in `MONGO_URI`.** They create and clean up their own fixtures (reserved phone prefix
`999000…`, email domain `@example.invalid`), but a crashed run can leave
residue visible on a live dashboard. `backend/scripts/cleanTestResidue.js`
reports (and, with `--delete`, removes) anything matching those reserved
patterns — it never touches a record that doesn't match them.

## Things worth knowing before you change code

- **IST day boundaries.** Appointment dates are stored at IST midnight. Never
  build a day window with `setHours()` — it resolves in the *server's*
  timezone, which is UTC on Render and IST on every developer's laptop. This
  class of bug has shipped to production more than once. Use
  `utils/getISTDayRange.js` / `utils/istDay.js` instead, and if you're
  testing a day-boundary change, run it against a server started with
  `TZ=UTC` — see `backend/tests/utcHost.test.js` for the pattern.
- **`updateMany` / `updateOne` / `findOneAndUpdate` bypass Mongoose's
  `pre("save")` hook**, which is where most business rules on `Appointment`
  live (BMI derivation, slot release, etc.). Use `.save()`, or add the
  matching hook to the query-based operation.
- **No FLEX.** An earlier scheduling concept called FLEX was removed
  entirely; don't reintroduce it. Late arrivals and no-shows go through the
  Waiting/Vacant List instead.
- **The six roles are deliberately separate** — separate models, separate
  JWT claims, separate auth middleware, separate `localStorage` keys. There
  is no shared `User` model to unify them into.
