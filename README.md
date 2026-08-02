# StationSnap

StationSnap is a mobile-first restaurant SOP, training, qualification, and checklist application.

## Repository status

Phases 0 and 1 are complete. The repository now includes a strict TypeScript web application, PostgreSQL migrations and demo seeds, shared server infrastructure, separate manager and employee layouts, accessible UI primitives, application states, and automated foundation tests.

Approved visual designs are still required before visual fidelity can be evaluated; see `docs/design-component-map.md` for the provisional functional mapping.

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
2. Install dependencies with `npm install`.
3. Apply the schema with `npm run db:migrate`.
4. Load the idempotent demo data with `npm run db:seed`.
5. Start the application with `npm run dev`.

`npm run db:verify` starts a temporary PostgreSQL instance, migrates it from empty, loads demo data, verifies record counts, and then removes the temporary database. Run `npm run verify` for formatting, linting, strict type checks, tests, and a production build.

The health endpoints are `/health` and `/api/health`. They return `503` without exposing connection details when PostgreSQL is unavailable.
