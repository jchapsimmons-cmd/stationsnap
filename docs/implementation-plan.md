# StationSnap Implementation Plan

## Phase 0 assessment

Assessment date: 2026-08-02

StationSnap is currently a greenfield repository. The repository contains Git metadata, repository hygiene files, an environment example, and documentation placeholders. It contains no application source, package manifest, database schema, migrations, tests, authentication implementation, runtime configuration, or approved design artifacts.

The supplied build-phase specification is therefore the product and acceptance-criteria baseline. No claim about visual conformity can be made until approved design source files or exports are added to `design/`.

## Current technology stack

| Area                  | Current state | Phase 1 decision boundary                                                                                                                                                       |
| --------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Application framework | None          | Select a maintained TypeScript web framework with server rendering and mobile-first routing. Next.js App Router is the leading candidate, subject to Phase 1 dependency review. |
| Language              | None          | TypeScript with strict checking and no unchecked JavaScript application paths.                                                                                                  |
| Database              | None          | PostgreSQL, as required. Choose and lock a typed migration/query layer in Phase 1.                                                                                              |
| Authentication        | None          | Select a manager session implementation that supports secure recovery or email login; implement separate employee PIN sessions in Phase 2.                                      |
| Validation            | None          | Shared schemas at every external boundary, including environment, forms, APIs, jobs, and AI output.                                                                             |
| Storage               | None          | Object-storage abstraction with private objects and signed access; provider selection can wait until media work.                                                                |
| Jobs                  | None          | Durable, idempotent background jobs before AI, schedules, or notification automation.                                                                                           |
| Testing               | None          | Unit, integration, browser E2E, accessibility, and tenant-isolation coverage.                                                                                                   |
| Observability         | None          | Structured, redacted logs and monitoring hooks.                                                                                                                                 |

Exact package versions and providers must be selected in Phase 1 from maintained releases and recorded in the lockfile and architecture notes. Phase 0 intentionally does not install dependencies.

## Existing implementation inventory

- Routes: none.
- Reusable components: none.
- Database structure or migrations: none.
- Authentication or authorization: none.
- Implemented product features: none.
- Runtime or build scripts: none.
- Automated tests: none.
- CI/CD or deployment configuration: none.
- Design files or screenshots: none.
- Agent instruction files: none beyond the externally supplied phase specification.

## Missing dependencies and decisions

1. Approved design source files, screen exports, breakpoints, tokens, and interaction states. Resolved in Phase 0/1.
2. Framework, package manager, supported Node runtime, and dependency versions. Resolved in Phase 1.
3. Typed PostgreSQL query/migration layer and local database workflow. Resolved in Phase 1.
4. Manager identity provider or self-hosted session approach, including email delivery. Resolved in Phase 2 (self-hosted sessions; SMTP for email).
5. Private object-storage provider and upload limits. Resolved: local disk for development, Vercel Blob in production (selected and configured directly against the live deployment).
6. Durable job runner and scheduled-job host. Still open; not required until Phase 20 automation needs it, since no phase before Phase 20 depends on background jobs.
7. Production host, region, domain, backup objectives, retention policy, and privacy requirements. Hosting (Vercel) and the production database (Neon Postgres) are resolved and live; remaining items (backup/retention policy, privacy documentation) are covered in Phase 19.
8. AI/transcription provider, AI-assisted translation provider, and SMS provider. Still open and deliberately deferred; required only for Phase 20, which must not start without an explicit decision from the project owner.

## Design conflicts

No comparison is possible because no approved designs are present. The product requirements call for manager desktop/mobile views and employee mobile-first views, but exact navigation, typography, spacing, colors, imagery, controls, and responsive behavior are unresolved. Development may establish semantic structure and accessibility in Phase 1, but any visual tokens must remain easy to replace when designs arrive.

## Security concerns to address from the first implementation

- Every tenant-owned row must carry `organization_id`; location-scoped rows must additionally carry `location_id` where applicable.
- Authorization must be evaluated server-side from trusted session context. Client-supplied organization, location, role, employee, or ownership claims are filters to validate, never authority.
- Manager and employee sessions must use separate cookies, guards, lifetimes, and login endpoints.
- Employee PINs and manager secrets must be one-way hashed; logs, audit metadata, fixtures, and errors must never contain raw credentials.
- Tenant and location predicates must be part of reusable repository/service access patterns, with database constraints as defense in depth.
- Media must remain private and be accessed through short-lived authorization checks or signed URLs.
- QR codes require high-entropy random tokens stored as hashes, revocation, stable destination indirection, and scan auditing.
- Mutating requests need CSRF protection or an equivalent same-origin strategy, validation, idempotency where double submission matters, and bounded rate limits.
- Uploads require size, content-type, signature, ownership, and lifecycle validation.
- Audit records must be append-only at the application layer and must exclude secrets and sensitive evidence URLs.
- Dates must be stored as UTC instants; recurrence and due-date calculations must explicitly use organization or location IANA timezones.
- AI output is untrusted input and must pass a versioned schema before becoming an editable draft.

## Technical debt and nonfunctional controls

There is no legacy technical debt because there is no application. The immediate risks are specification breadth, delayed design input, and accidental coupling between separate domains. Training sessions, checklist runs, SOP versions, assignments, approvals, qualifications, and notifications must remain separate business objects even when they share UI primitives.

No features merely appear complete: there is currently no application UI and therefore no fake buttons or placeholder interactions. Future placeholder labels, especially the employee training summary and checklist QR destination named in the requirements, must be clearly read-only until their implementation phase.

## Proposed architecture boundaries

- `app/` or equivalent: route composition, layouts, error/loading boundaries, and transport adapters.
- `components/`: accessible design-system primitives and domain-neutral compositions.
- `features/`: organization, people, SOP, training, checklist, reporting, notification, and printing modules.
- `server/auth/`: manager sessions, employee sessions, guards, rate limits, and authorization context.
- `server/db/`: schema, migrations, tenant-aware repositories, transactions, and seed tooling.
- `server/storage/`: private uploads, signed access, metadata, cleanup, and thumbnails.
- `server/jobs/`: durable jobs, schedules, retries, idempotency, and stuck-job recovery.
- `server/audit/`: append-only security and business-event recording.
- `lib/`: environment validation, schemas, errors, logging, time, pagination, and shared types.
- `tests/`: factories, isolation helpers, integration tests, browser tests, and fixtures.

Domain services should own invariants and transactions. Route handlers should authenticate, validate, call a service, and translate typed outcomes into a shared response or redirect. Direct database access from client components is prohibited.

## Implementation sequence after Phase 0

The exact technical order preserves the numbered phases because each later capability depends on durable records and invariants introduced earlier:

1. Phase 1: lock the runtime, strict TypeScript, validated environment, PostgreSQL migrations, shared errors/logging, layouts, accessible primitives, seed system, and test harness.
2. Phase 2: establish manager and employee session separation, reusable authorization context, tenant/location guards, credential security, rate limits, and audit events.
3. Phase 3: implement organizations, locations, stations, managers, employees, roles, and the ownership constraints used by all later work.
4. Phase 4: build a fully usable manual SOP draft editor and media pipeline before introducing version or AI complexity.
5. Phase 5: freeze immutable published versions, stable current-version resolution, restoration, comparison summaries, and retraining rules.
6. Phase 6: deliver the authorized employee reader and stable, revocable QR indirection.
7. Phase 7: define validated training configuration and questions independent of execution.
8. Phase 8: implement the server-enforced training state machine, evidence, attempts, grading, and resume behavior.
9. Phase 9: resolve targeting into independent employee assignments with due dates and duplicate prevention.
10. Phase 10: add immutable approval decisions and correction evidence history.
11. Phase 11: compose completed training into ordered paths and qualification lifecycle rules.
12. Phase 12: implement checklists as a separate aggregate while reusing media, timer, and approval primitives.
13. Phase 13: add separately stored, reviewable translations entered and approved manually by managers, without altering progress identity. AI-assisted translation drafting is not part of this phase; see Phase 20.
14. Phase 14: build aggregates, paginated reports, and activity history from real domain events.
15. Phase 15: add permission-aware print, PDF, and CSV representations of versioned records.
16. Phase 16: turn domain events and time calculations into idempotent in-app and SMTP-backed email notifications, reusing the existing Phase 2 email delivery mechanism. SMS is explicitly out of scope for this phase, matching the approved design's v1 notification scope; see Phase 20.
17. Phase 17: audit every boundary; fix high/medium security and performance findings and add regressions.
18. Phase 18: automate the complete cross-role lifecycle on clean databases and representative viewports.
19. Phase 19: harden the already-live production deployment: PWA metadata, backup/retention policy, rollback rehearsal, and a production-like release verification. Hosting (Vercel), the production database (Neon Postgres), and object storage (Vercel Blob) were already selected and configured directly against production ahead of schedule, so this phase covers the remaining operational work rather than initial provider selection.
20. Phase 20 (deferred; requires explicit provider decisions from the project owner before starting): add the durable, schema-validated video-to-draft AI workflow, upgrade Phase 13's manual translations with AI-assisted drafting, and add an SMS notification channel alongside Phase 16's email/in-app channels. Do not attempt automatically. An automated pipeline reaching this point must stop, record exactly which provider decisions are needed, and wait rather than guessing.

## Phase gates

Each phase must finish with formatting, linting, strict type checking, relevant migrations from an empty database, seed verification when applicable, and automated tests. A phase is not complete when controls are decorative, authorization exists only in the browser, or documented acceptance criteria have not been exercised.

Design files should ideally arrive before Phase 1 UI tokens are finalized and no later than before Phase 3 product screens. If they arrive later, perform a design reconciliation before continuing feature work rather than allowing visual divergence to compound.
