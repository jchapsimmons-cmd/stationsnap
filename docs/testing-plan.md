# StationSnap Testing Plan

## Objectives

Testing must prove business invariants, tenant/location isolation, server-enforced progression, immutable history, accurate time calculations, secure file access, and usable mobile workflows. Passing component snapshots alone is insufficient.

## Test layers

| Layer                     | Scope                                                                                              | Runs                                                    |
| ------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Static checks             | Formatting, lint rules, strict TypeScript, dependency and migration consistency                    | Every change                                            |
| Unit tests                | Pure validation, state machines, scores, due dates, recurrence, qualification and retraining rules | Every change                                            |
| Database integration      | Constraints, transactions, repositories, tenant predicates, migrations and indexes                 | Every pull request against PostgreSQL                   |
| Service/route integration | Authentication, authorization, validation, idempotency, errors, jobs, uploads with provider fakes  | Every pull request                                      |
| Component tests           | Accessible behavior, form validation, state rendering, keyboard/touch interactions                 | Every pull request for UI changes                       |
| Browser E2E               | Cross-role workflows on real app/database and representative viewports                             | Critical subset per PR; full suite before phase/release |
| Security regression       | IDOR/tenant escape, rate limits, session separation, QR/file/upload abuse, CSRF                    | Every relevant change and full audit                    |
| Performance checks        | Query counts/plans, list pagination, payload/media budgets, dashboard aggregates                   | Feature gates and release audit                         |
| Visual/accessibility      | Approved-screen comparison, automated accessibility plus manual keyboard/screen-reader review      | After designs exist and before phase signoff            |

## Test environment and data

- Use PostgreSQL rather than an in-memory substitute for database integration and E2E.
- Apply migrations from an empty database for every isolated CI run.
- Create data through typed factories or public services, not shared mutable snapshots.
- Maintain at least two organizations, multiple locations, Owner, location-restricted Manager, enabled/disabled employees, and cross-tenant records in authorization suites.
- Use deterministic clocks, IANA timezones, UUIDs, provider fakes, and controlled job execution.
- Store no production data or real credentials in fixtures.
- Make E2E workers database-isolated or namespace their records so parallel runs cannot collide.

## Core invariant matrix

| Domain             | Required proof                                                                                                                                                  |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenancy            | A user cannot read, mutate, infer existence of, export, print, scan, or access media from another organization.                                                 |
| Locations          | Restricted Managers and Employees cannot cross authorized locations through URLs, filters, payload IDs, bulk targets, or indirect relations.                    |
| Sessions           | Manager and employee cookies are non-interchangeable, expire/revoke correctly, and preserve only safe internal redirects.                                       |
| Credentials        | PIN/password/recovery values never persist or log in plain text; rate limits and temporary lockouts behave deterministically.                                   |
| SOPs               | Publish requires valid finished uploads and steps; publication is immutable; restoration and editing clone drafts; training retains exact version.              |
| QR                 | Tokens are high entropy, revocable, stable across publication updates, and do not reveal sequential identities.                                                 |
| Training           | Server rejects skipped requirements, duplicate transitions, excess attempts, invalid scoring, and unauthorized evidence. Resume returns the authoritative step. |
| Approvals          | Decisions are permanent, notes are required where specified, corrections retain original and replacement evidence, and status transitions are valid.            |
| Qualifications     | Awards require every configured prerequisite; expiry/revocation retains history; timezone/date calculations are correct.                                        |
| Checklists         | Required proof/timers block completion; submission is idempotent; submitted runs cannot be silently edited.                                                     |
| AI/translations    | Only schema-valid AI data enters drafts; AI never publishes; approved translations are not overwritten.                                                         |
| Notifications/jobs | Dedupe keys prevent repeats, retries are safe, disabled accounts receive nothing, and timezone windows are correct.                                             |

## Phase-by-phase minimum coverage

1. Phase 1: environment schema failures, API/error mapping, health response, migrations from empty, seed idempotency, primitive accessibility states.
2. Phase 2: successful/failed/disabled login, expiry/logout/recovery, PIN hashing, rate limits/lockout, route guards, owner/manager/employee permissions, cross-org and cross-location matrix, audit events.
3. Phase 3: organization/location/station/employee validation, status changes, assignments, search/filter pagination, secure PIN resets and disabled login.
4. Phase 4: draft creation/autosave conflicts, step add/edit/duplicate/delete/reorder, uploads/retries, preview, publish validation and permissions.
5. Phase 5: immutable publications, draft cloning, history, restoration, retraining selections, stable current resolution and historical training reference.
6. Phase 6: every QR target/status, destination preservation, authorization, scan event, responsive SOP viewer and unavailable/offline states.
7. Phase 7: every training mode/config combination, bounds, incompatible settings, per-step requirements, question correctness/order and config copy.
8. Phase 8: state-machine transition table, refresh/resume, offline retry, duplicate action, watch/timer/question/evidence enforcement, score/attempt limits.
9. Phase 9: individual and every bulk target resolution, due times/timezones, independent records, deliberate retraining and active-duplicate rejection.
10. Phase 10: queue scope, evidence authorization, all decisions, note rules, PIN confirmation, corrections/history, notifications and audit.
11. Phase 11: ordered path blocking, award prerequisites, validity/expiry/expiring/revocation and historical support.
12. Phase 12: definitions/recurrence, runs, timers/photos/notes, pause/resume, idempotent submit, approval/correction and filter scope.
13. Phase 13 (manual translations): field/step entry and review/approval, untranslated flags, protected names/measurements and language switching during active progress. No AI generation to validate in this phase; see Phase 20.
14. Phase 14: aggregate accuracy, filters, tenant/location scope, pagination, query count/plan and empty states.
15. Phase 15: permission scope, exact version/data, multi-page layout, QR scan verification, PDF extraction checks and CSV injection safety.
16. Phase 16 (email/in-app notifications): recipient/destination accuracy, dedupe, retries, read state, timezone boundaries, disabled recipients and safe email content. No SMS channel to validate in this phase; see Phase 20.
17. Phase 17: regression for each finding, upload/media abuse, IDOR matrix, CSRF, secrets/errors, indexes/query plans and mobile budgets.
18. Phase 18: full specified lifecycle and exception matrix on small phone, large phone, tablet, and desktop.
19. Phase 19: missing-config failure, health checks, no test credentials/data, backup/retention rehearsal and rollback rehearsal documentation against the already-live Vercel/Neon/Blob production configuration.
20. Phase 20 (deferred; requires provider decisions first): upload/job lifecycle, schema rejection, retry/stuck recovery, single-step regeneration, preserved original, manual fallback and never-auto-publish assertion for AI video-to-draft; AI-assisted translation acceptance; SMS delivery, opt-out and safe content.

## E2E critical path

Automate the complete Owner setup through SOP creation, training configuration/publication, QR creation, assignment, Employee PIN login and Guided completion, evidence/quiz, Manager approval, qualification award, SOP update/retraining, and Employee retraining. Use page objects sparingly; prefer user-visible roles and labels so inaccessible or misleading UI fails tests.

Required viewports:

- Small phone: approximately 320–375 CSS pixels wide.
- Large phone: approximately 390–430 CSS pixels wide.
- Tablet: approximately 768–1024 CSS pixels wide.
- Desktop: at least 1280 CSS pixels wide.

## Security test method

For every protected service and route, run an access matrix with: unauthenticated, wrong session type, same organization/wrong location, wrong organization, disabled actor, insufficient role, valid actor, missing record, and altered related-record ID. Assert both response and lack of database/file side effects. Avoid distinguishable not-found responses that leak cross-tenant existence.

Add malicious cases for oversized/forged uploads, path/object-key manipulation, open redirects, replayed idempotency keys, CSRF, stale revisions, brute-force PIN attempts, QR enumeration, formula-leading CSV cells, and untrusted AI/translation markup.

## Quality gates and evidence

Before each phase closes, record exact commands and outcomes. Required gates are clean formatting, lint, strict type check, relevant unit/integration/component/E2E tests, empty-database migration, and production build when the application exists. Do not skip or weaken a failing test. Quarantined tests require an owner, reason, and short expiry and cannot cover a critical security or business invariant.

Because approved designs are absent, visual regression baselines cannot be accepted during Phase 0. Add baseline screenshots only after design reconciliation; otherwise tests may entrench an unapproved UI.
