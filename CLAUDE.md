# MediFlow — Project Instructions

MERN outpatient appointment and queue platform. Backend Node/Express
(**CommonJS**) + Mongoose/MongoDB Atlas; frontend React 18 + Vite (**ESM**) +
Tailwind. Backend on Render, frontend on Vercel.

MediFlow is a fictional multi-specialty clinic network used as a portfolio
project. All branch data is demo data (see `backend/scripts/seedDemoBranches.js`).

## Working rules

1. **Do not rewrite the existing architecture.** The per-role split, the inline
   `server.js` routes and the model-hook business rules are deliberate.
2. **Inspect before modifying.** Comments in `istDay.js`, `queueOrder.js` and
   `queueStatus.js` describe bugs that already shipped. They are warnings.
3. **Preserve working functionality.** Do not delete features or create a second
   system alongside one that works.
4. **Run tests after significant changes** — all three:
   - `cd backend && npm test`
   - `cd frontend && npx vite build`
   - `cd frontend && npx playwright test`
5. **Do not commit or push.** Local development only.
6. **Never expose or commit secrets.** `.env` is gitignored; keep it that way.
7. **Do not modify unrelated files.** Smallest safe change.
8. **Do not claim a feature is complete without verifying it** against the real
   endpoint and the real database.
9. **Never use `setHours()` for day boundaries.** Use `getISTDayRange()` or
   `normalizeToIstDay()`. Dates are stored at IST midnight; servers run UTC.
   This bug has shipped to production twice.
10. **`updateMany` / `updateOne` / `findOneAndUpdate` bypass `pre("save")`,**
    where most business rules live. Use `.save()` or add the matching query hook.
11. **Demo data only.** The only seeded locations are the clearly fictional
    branches in `seedDemoBranches.js`. Never add real hospital names, addresses
    or phone numbers. If test residue appears in the database, delete it and say so.

> ⚠️ Local runs and the test suites read and write whatever database
> `MONGO_URI` points at. Clean up anything a test creates.

## Phased development

Work proceeds in explicit phases. Implement **only the current phase**, test it,
summarise, and **stop**. Do not continue to the next
phase until told to. This is intentional: it limits context usage and makes
debugging safer.

---

# Task-Based Model Delegation

Use the custom subagents in `.claude/agents/` proactively. The goal is to reduce
context usage and match the model to the complexity of the task.

## Quick / Low Complexity → `quick-worker`  (model: **haiku**)

- simple searches
- file discovery
- simple inspection
- straightforward CSS
- text changes
- simple checks
- repetitive low-risk work
- simple test analysis

## Normal Coding → `coding-worker`  (model: **sonnet**)

- normal frontend work
- normal backend work
- API work
- components
- forms
- ordinary bug fixes
- moderate refactoring
- tests
- normal integrations

## Complex / High Risk → `architecture-worker`  (model: **opus**)

- architecture
- database design
- authentication
- authorization
- security
- appointment scheduling
- queue logic
- Waiting/Vacant List
- Flex/Recovery slots
- Nurse workflow
- Lab architecture
- LabTest / LabOrder / LabResult relationships
- difficult debugging
- major cross-module changes
- data-integrity issues

## Delegation rules

When a task contains multiple complexity levels:

1. Use `quick-worker` for simple exploration.
2. Use `coding-worker` for normal implementation.
3. Use `architecture-worker` for complex decisions or high-risk implementation.

- Do **not** automatically use Opus for every small task.
- Do **not** delegate security, database architecture, scheduling, queue or
  medical workflow decisions to `quick-worker`.
- Do **not** use a cheaper model merely to save tokens if doing so risks
  breaking the architecture.
- The main Claude session remains responsible for coordinating the work.
- Subagents return **concise summaries**, not large amounts of code.

## Worked examples for this project

| Task | Agent |
|---|---|
| "Find where appointment statuses are defined." | `quick-worker` |
| "Inspect the repository and find all references to LabResult." | `quick-worker` |
| "Fix a typo in the patient portal." | `quick-worker` |
| "Change a simple button style." | `quick-worker` |
| "Change the receptionist dashboard UI." | `coding-worker` |
| "Add a new nurse dashboard using existing APIs." | `coding-worker` |
| "Implement a new API endpoint." | `coding-worker` |
| "Design the LabTest → LabOrder → LabResult architecture." | `architecture-worker` |
| "Modify Waiting/Vacant List assignment logic." | `architecture-worker` |
| "Modify authentication / role permissions." | `architecture-worker` |
| "Debug a complex cross-role authorization problem." | `architecture-worker` |

## Context discipline

- Subagents must not dump repository contents into the main conversation.
  Prefer *"Found X in file Y; the relevant function is Z"* over pasting files.
- Use focused searches. Read large files only when necessary.
- Only inspect files relevant to the current task.
- Do not repeatedly rediscover the same information — `CLAUDE.md` is the
  persistent project context.
