# StationSnap Data Model

This document defines the planned logical PostgreSQL model. It is not a migration. Names and field types should be finalized in Phase 1, with constraints implemented in the database and invariants repeated in domain services.

## Global conventions

- Primary keys are UUIDs or another non-sequential opaque type.
- Tenant-owned tables include `organization_id NOT NULL`; location-owned tables include `location_id NOT NULL` where meaningful.
- Foreign keys must prevent cross-tenant relationships. Prefer composite uniqueness and composite foreign keys where they materially strengthen tenant isolation.
- Mutable records include `created_at`, `updated_at`, and creator/updater identities when relevant.
- Business deletion is generally a status or `archived_at`/`disabled_at`; immutable published and historical records are never physically deleted through normal product flows.
- Timestamps are stored as UTC instants. Organizations and locations store validated IANA timezone names.
- User-visible ordering uses explicit integer positions with uniqueness scoped to the parent.
- High-entropy secrets such as QR tokens and recovery tokens are stored hashed when lookup permits.
- File metadata is separate from business records; authorization is derived through tenant-scoped links.

## Identity and tenancy

| Table                      | Purpose and important fields                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations`            | Name, logo file, default language, timezone, status. Root tenant boundary.                                                                                                        |
| `locations`                | Organization, name, timezone, status, address metadata.                                                                                                                           |
| `manager_users`            | Email/verified identity, display name, status, credential/provider identity. Never stores recoverable passwords.                                                                  |
| `manager_memberships`      | Manager, organization, role (`owner`, `manager`), status. Unique per manager/organization.                                                                                        |
| `manager_location_access`  | Membership-to-location grants. Owners derive all-location access; manager grants are explicit.                                                                                    |
| `employees`                | Organization, primary location, employee number, display name, job role, preferred language, status, PIN hash metadata. Employee numbers unique within organization when present. |
| `employee_location_access` | Optional additional authorized locations; use only if product policy permits multi-location employees.                                                                            |
| `manager_sessions`         | Hashed session token, manager/membership context, expiry, revocation, rotation metadata.                                                                                          |
| `employee_sessions`        | Separate hashed token, employee/location context, expiry and revocation.                                                                                                          |
| `login_attempts`           | Credential type, normalized subject hash, tenant/access context, outcome, IP/user-agent risk metadata, timestamp. Supports bounded rate limiting without logging raw PINs.        |
| `recovery_tokens`          | Manager, hashed token, expiry, consumed timestamp.                                                                                                                                |
| `audit_events`             | Organization, location when applicable, actor type/id, action, target type/id, safe metadata, request correlation, timestamp. Append-only application behavior.                   |

## Files and media

| Table            | Purpose and important fields                                                                                                                               |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `files`          | Organization, uploader actor, private object key, original name, media type, byte size, checksum, processing/scan status, dimensions/duration, timestamps. |
| `file_variants`  | Parent file, thumbnail/transcode type, object key, dimensions/duration, processing status.                                                                 |
| `upload_intents` | Authorized target, expected constraints, expiry, completion/idempotency state.                                                                             |

## Locations, stations, and people

| Table                          | Purpose and important fields                                                                |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| `stations`                     | Organization, location, name, image, description, display order, active/archived status.    |
| `job_roles`                    | Organization, optional location scope, name, status.                                        |
| `employee_station_assignments` | Employee, station, assignment type/status. Enables targeting and qualification comparisons. |

## SOP aggregate and immutable versions

| Table                           | Purpose and important fields                                                                                                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sops`                          | Permanent identity, organization, owning location/station, current published version, status, stable QR destination identity.                                                                                                                                                             |
| `sop_versions`                  | SOP, version number, lifecycle (`draft`, `published`, `archived`), title, description, category, estimate, difficulty, cover/source files, change summary, publisher/date, immutable publication metadata. At most one active draft per editing policy and unique version number per SOP. |
| `sop_materials`                 | Version, kind (`material`, `ingredient`), name, quantity, unit, display order. Version-owned so publications remain immutable.                                                                                                                                                            |
| `sop_warnings`                  | Version, text, severity/display order.                                                                                                                                                                                                                                                    |
| `sop_steps`                     | Version, display order, title, instruction, media, warning, quantity/unit, equipment setting, timer seconds, required flag.                                                                                                                                                               |
| `sop_retraining_rules`          | Published version, rule type, selected roles/locations as normalized child rows, source version when applicable.                                                                                                                                                                          |
| `sop_retraining_rule_roles`     | Rule-to-job-role selection.                                                                                                                                                                                                                                                               |
| `sop_retraining_rule_locations` | Rule-to-location selection.                                                                                                                                                                                                                                                               |
| `sop_recent_views`              | Employee, SOP/version, last viewed timestamp; unique employee/SOP.                                                                                                                                                                                                                        |

Published versions and their materials, warnings, steps, questions, and training configuration are immutable. Editing or restoration clones content into a new draft version.

## QR access

| Table            | Purpose and important fields                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `qr_codes`       | Organization/location scope, token hash, target type, stable target identity, status, revoked metadata, creator, timestamps. Never embeds sequential IDs. |
| `qr_scan_events` | QR, resolved target, actor/session when known, result, safe device metadata, timestamp.                                                                   |

## Training configuration

| Table                        | Purpose and important fields                                                                                                                                                                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `training_configs`           | SOP version, enabled/optional/required state, default mode, navigation/progression flags, watch/timer/evidence/approval rules, passing score, maximum attempts, qualification, validity and retraining values. One immutable config per published version. |
| `step_training_requirements` | Step, full-video, confirmation, timer, question, photo, video, and approval requirements.                                                                                                                                                                  |
| `training_questions`         | Version/optional step, type, text, explanation, points, placement, display order, explanation policy.                                                                                                                                                      |
| `training_question_choices`  | Question, choice text, correctness, display order. Correctness is manager-only.                                                                                                                                                                            |

## Assignments and training execution

| Table                         | Purpose and important fields                                                                                                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `training_assignment_batches` | Manager request describing original individual/bulk target, note, due settings, retraining intent.                                                                                                              |
| `training_assignments`        | One employee, SOP version, required mode, due instant/timezone basis, passing/approval requirements, assigner, status, retraining generation. Prevent duplicate active assignment unless explicitly retraining. |
| `training_sessions`           | Assignment, attempt number, mode, status, current step, score, start/resume/submit/completion timestamps, idempotency/version fields.                                                                           |
| `training_step_progress`      | Session, step, status, confirmations, timer/watch progress, answer/proof state, timestamps. Unique session/step.                                                                                                |
| `training_answers`            | Session, question, selected choice, awarded points, correctness snapshot, answered timestamp.                                                                                                                   |
| `training_evidence`           | Session/step, file, evidence type, submission generation, status, employee note.                                                                                                                                |
| `approval_submissions`        | Session or checklist run, submission generation, status, submitted timestamp.                                                                                                                                   |
| `approval_decisions`          | Submission, manager, decision, required note, optional PIN-confirmation audit reference, timestamp. Immutable history.                                                                                          |
| `correction_requests`         | Submission/decision, manager note, replacement generation and resolution. Original evidence remains linked.                                                                                                     |

Training status transitions must be implemented as a server-side state machine inside transactions. Attempts, step progress, answers, evidence, and decisions are historical records, not overwritable summaries.

## Paths and qualifications

| Table                               | Purpose and important fields                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `training_paths`                    | Organization/location/station, title, description, qualification definition, order-enforcement flag, status.   |
| `training_path_items`               | Path, SOP, required flag, display order and version-resolution policy.                                         |
| `qualification_definitions`         | Organization, optional station, name, description, default validity, status.                                   |
| `employee_qualifications`           | Employee, definition, source path, awarded/expiry dates, status, approver, revoked metadata. History retained. |
| `qualification_supporting_sessions` | Qualification-to-completed-session links proving the award.                                                    |

Qualification status should be derived from immutable award/revocation facts and time, with a cached status only if transactionally maintained.

## Checklists

| Table                     | Purpose and important fields                                                                                                                                                                                 |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `checklists`              | Organization, location, station, type, title, recurrence specification, active status.                                                                                                                       |
| `checklist_items`         | Checklist, display order, title, instructions, required flag, timer, photo/approval/note requirements, reference file.                                                                                       |
| `checklist_runs`          | Checklist snapshot/version reference, employee, location, scheduled occurrence key, status, started/submitted/completed timestamps. Unique occurrence/employee policy prevents duplicate runs as configured. |
| `checklist_item_progress` | Run, item, completion, timer state, employee note, timestamps.                                                                                                                                               |
| `checklist_evidence`      | Item progress, private file, generation/status.                                                                                                                                                              |

Checklist records remain separate from SOP training records. Shared approval tables may use a typed subject reference only if foreign-key integrity remains enforceable; otherwise use dedicated checklist decision tables.

## AI and translations

| Table                | Purpose and important fields                                                                                                                                                                 |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai_sop_jobs`        | Organization, SOP draft, source file, provider/model metadata, schema version, status, attempts, lease/heartbeat, retry time, safe failure code, timestamps.                                 |
| `ai_sop_job_outputs` | Job, validated structured JSON, acceptance/rejection state, provenance. Never directly published.                                                                                            |
| `translations`       | Organization, entity type/id/field, source locale/text hash, target locale, translated text, status, provider/provenance, reviewer, approved timestamp. Unique source revision/target/field. |

## Notifications and reporting events

| Table                     | Purpose and important fields                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `domain_events`           | Transactional outbox event with organization, type, subject, safe payload, occurrence time, processing status. |
| `notifications`           | Recipient type/id, event/dedupe key, title/body key and safe parameters, internal destination, read timestamp. |
| `notification_deliveries` | Notification, channel, configured recipient, status, attempt and provider metadata.                            |
| `scheduled_job_runs`      | Job type, organization/location/time bucket, idempotency key, status, attempts and timestamps.                 |

Dashboards and reports should query canonical tables with tenant predicates, bounded date ranges, pagination, and purpose-built indexes. Materialized summaries should be introduced only after measurement proves a need.

## Required index families

- Every foreign key and every common `(organization_id, status)` filter.
- Location-scoped lists: `(organization_id, location_id, status, updated_at)`.
- SOP library: organization/location/station/category/status plus updated/published time.
- Assignments: employee/status/due time and organization/location/status/due time.
- Approval queues: organization/location/status/submitted time.
- Training history: employee/SOP version/status/completion time.
- Checklist occurrence and run status/date filters.
- Qualification employee/status/expiry and organization/location expiry reporting paths.
- Hashed session, recovery, and QR-token lookup columns with unique indexes.
- Notification recipient/read/created and unique dedupe keys.
- Job status/retry/lease timestamps and unique idempotency keys.

Final indexes must be justified with actual query plans during Phases 15 and 18 rather than added indiscriminately.
