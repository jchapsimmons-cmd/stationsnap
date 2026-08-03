# StationSnap

StationSnap is a mobile-first restaurant SOP, training, qualification, and checklist application.

## Repository status

Phases 0 through 4 are complete. The repository now includes the project foundation, secure manager and employee authentication, tenant-safe manager tools for organization settings, locations, stations, manager location assignments, and employees, and a manual SOP builder with draft autosave, a step editor, media uploads, an employee-view preview, and an immutable publish workflow.

The approved 20-screen mobile workflow handoff and Nocturne design system are stored in `design/stationsnap-mobile-workflows/`. New and revised screens must use that package as their visual and interaction source of truth.

The Phase 1–4 application shells, authentication screens, shared controls, setup views, people-management views, and SOP builder views use the approved Nocturne dark/light tokens and Phosphor icon system.

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
