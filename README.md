# StationSnap

StationSnap is a mobile-first restaurant SOP, training, qualification, and checklist application.

## Repository status

Phases 0 through 8 are complete. The repository now includes the project foundation, secure manager and employee authentication, tenant-safe manager tools for organization settings, locations, stations, manager location assignments, and employees, a manual SOP draft builder, immutable SOP publication with version history, restoration, comparison, and retraining rules, the authorized employee reader with revocable QR indirection, validated per-version training configuration and question authoring, and a server-enforced training session state machine with evidence, attempts, and grading.

Publishing an SOP freezes an immutable version. Editing a published SOP always starts a new draft cloned from the current (or any historical) version; publishing that draft creates the next version and never mutates prior published records. Publishing an update requires a change summary and an explicit retraining rule (none, all currently qualified employees, selected job roles, or selected locations), recorded against the newly published version for later training phases to act on.

Employees browse published SOPs scoped to their authenticated location through stations and recipe/cleaning/opening/closing libraries, view a full procedure reader, and see recently viewed procedures. Managers generate stable, revocable QR codes under `/manager/qr` that always resolve to a station's library or an SOP's current published version; scanning a QR at `/q/[token]` preserves the destination through employee sign-in. QR tokens are stored only as hashes, every scan is recorded with its outcome, and a revoked or reissued QR immediately invalidates its previous printed code.

Managers now define validated training configuration and questions for a draft, independent of any employee-facing execution. `/manager/sops/[sopId]/training` sets one config per SOP version: a requirement state (not part of training, optional, or required), a default mode (Learn, Guided, Test, or Demonstration), navigation/progression flags (allow backtracking, require sequential steps), watch/evidence/approval rules (require full video watch, require evidence approval), a passing score and maximum attempts, and optional qualification-validity and retraining-grace day counts; each step separately carries full-video, confirmation, timer, question, photo, video, and approval requirement toggles. `/manager/sops/[sopId]/training/questions` builds step-attached (before/after-step) or final single-choice, multiple-choice, or true/false questions with ordered choices, points, an explanation, and an explanation-display policy; no questions is a valid configuration. Requirement/mode combinations, score and attempt bounds, and choice-correctness rules are enforced with Zod; publishing rejects a required test/demonstration configuration with no questions anywhere or a question-required step with no attached question, and rejects step timer/full-video requirements when the step itself has no timer or video. Starting a new draft clones the source version's training configuration, per-step requirements, and questions/choices alongside its materials, warnings, and steps; publishing always freezes a default (disabled) training configuration onto the version even if a manager never opened the training page.

A single-employee `assignTraining` service binds an employee to a published SOP version and a required mode; bulk targeting, due dates, and full duplicate-active resolution across a batch remain Phase 9 scope, though a minimal duplicate-active guard (one non-failed, non-cancelled assignment per employee/version) is already enforced. From `/employee/training/[assignmentId]`, employees start or resume a training session; `/employee/training/[assignmentId]/session/[sessionId]` runs the server-enforced engine: steps unlock in order when the version requires sequential progress (with backtracking to already-completed steps only when allowed), and a step is not considered complete until every one of its configured requirements is met — full video watch, timer completion, an explicit confirmation, an answered attached question, and/or uploaded photo/video evidence of the matching media type. Quiz answers are graded server-side against manager-only correct choices and can be revised until final submission; explanations are revealed per the question's display policy. Employees upload their own evidence directly (the `files` table now accepts either a manager or an employee uploader, mutually exclusive); evidence is append-only, keeping every submission generation. Final submission is blocked until every required step and final question is complete, is idempotent once a session leaves `in_progress` (safe to retry after a dropped connection), and every mutating action is guarded by an optimistic-concurrency revision so a stale or duplicate retry is rejected rather than double-applied. Submission computes a percentage score, routes to `awaiting_approval` (creating a pending `approval_submissions` row) whenever the version's evidence-approval setting and at least one completed step's approval requirement call for manager review, and otherwise resolves immediately to `passed` or `failed` against the version's passing score, updating the assignment and respecting its maximum attempts; exhausting attempts without passing fails the assignment, and a manager can then create a fresh retraining assignment. Manager review and decisioning of `awaiting_approval` submissions, and the full assignment-targeting/due-date UI, remain out of scope until later phases.

The approved 20-screen mobile workflow handoff and Nocturne design system are stored in `design/stationsnap-mobile-workflows/`. New and revised screens must use that package as their visual and interaction source of truth.

The Phase 1–3 application shells, authentication screens, shared controls, setup views, and people-management views use the approved Nocturne dark/light tokens and Phosphor icon system.

## Add source materials

- Put product requirements and coding plans in `product/`.
- Put approved design source files, exports, and screenshots in `design/`.
- Put technical assessment and implementation planning documents in `docs/`.
- Do not commit passwords, API keys, database credentials, employee PINs, or production data.

## Phase 0 documents

- `docs/implementation-plan.md`
- `docs/route-map.md`
- `docs/data-model.md`
- `docs/design-component-map.md`
- `docs/testing-plan.md`

## Local environment

1. Copy `.env.example` to `.env` and replace the example PostgreSQL credentials.
2. Set a development-only `SEED_MANAGER_PASSWORD` of at least 12 characters and a four-digit `SEED_EMPLOYEE_PIN`. These values are hashed before storage and seeds are rejected in production.
3. Install dependencies with `npm install`.
4. Apply the schema with `npm run db:migrate`.
5. Load the idempotent demo data with `npm run db:seed`.
6. Start the application with `npm run dev`.

Manager password reset requires all `SMTP_*` settings. The application uses generic reset responses, single-use 30-minute tokens, and revokes existing manager sessions after a successful reset.

Manager setup routes begin at `/manager`. Owners can update organization settings, create locations, and assign managers to locations. Managers can update permitted locations and manage stations and employees only within those locations. Organization logos and station images currently use validated HTTPS URLs; private object uploads are introduced with the later media phases.

The demo employee access codes are `stationsnap-demo` and either `downtown` or `riverside`. Manager emails and employee numbers are defined in `src/server/db/seed-data.ts`; their secrets come only from the local seed environment.

`npm run db:verify` starts a temporary PostgreSQL instance, migrates it from empty, loads demo data, verifies record counts, and then removes the temporary database. Run `npm run verify` for formatting, linting, strict type checks, tests, and a production build.

The health endpoints are `/health` and `/api/health`. They return `503` without exposing connection details when PostgreSQL is unavailable.
