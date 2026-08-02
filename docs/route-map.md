# StationSnap Route Map

This is the planned route contract for a greenfield implementation. Segments in brackets are opaque public identifiers or slugs, never raw sequential database IDs. Final URL labels may be adjusted to match approved designs, but permission and data boundaries must remain intact.

## Public and access routes

| Route                      | Purpose                                                         | Access                                  |
| -------------------------- | --------------------------------------------------------------- | --------------------------------------- |
| `/`                        | Product entry and authenticated-role redirect                   | Public                                  |
| `/manager/login`           | Manager sign-in                                                 | Signed-out manager                      |
| `/manager/recover`         | Password reset or secure email-link request                     | Signed-out manager                      |
| `/manager/recover/confirm` | Complete verified recovery                                      | Valid recovery token                    |
| `/employee/access`         | Organization/location access entry                              | Public                                  |
| `/employee/login`          | Employee selection/number and PIN entry                         | Public with resolved access context     |
| `/q/[token]`               | Validate QR and preserve the destination through authentication | Public token; target remains authorized |
| `/q/invalid`               | Invalid, revoked, or unavailable QR state                       | Public                                  |
| `/health`                  | Minimal liveness/readiness result without sensitive data        | Operations/public per deployment policy |

## Manager routes

All `/manager/*` application routes require a valid manager session. Owners are organization-wide; managers are restricted to explicitly assigned locations.

| Route                                             | Screen or action scope                                    | Minimum permission                       |
| ------------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| `/manager`                                        | Dashboard                                                 | Manager                                  |
| `/manager/notifications`                          | In-app notifications                                      | Manager                                  |
| `/manager/activity`                               | Authorized activity history                               | Manager                                  |
| `/manager/settings/organization`                  | Organization profile, logo, language, timezone, status    | Owner; limited read for Manager          |
| `/manager/settings/locations`                     | Location list                                             | Manager, scoped                          |
| `/manager/settings/locations/new`                 | Create location                                           | Owner                                    |
| `/manager/settings/locations/[locationId]`        | Location details                                          | Manager assigned or Owner                |
| `/manager/settings/locations/[locationId]/edit`   | Edit/disable location and assignments                     | Owner; delegated fields only if approved |
| `/manager/settings/stations`                      | Station list and filters                                  | Manager, scoped                          |
| `/manager/settings/stations/new`                  | Create station                                            | Manager, scoped                          |
| `/manager/settings/stations/[stationId]`          | Station details                                           | Manager, scoped                          |
| `/manager/settings/stations/[stationId]/edit`     | Edit/archive/reorder station                              | Manager, scoped                          |
| `/manager/employees`                              | Search and filter employees                               | Manager, scoped                          |
| `/manager/employees/new`                          | Create employee and initial PIN                           | Manager, scoped                          |
| `/manager/employees/[employeeId]`                 | Employee profile and training summary                     | Manager, scoped                          |
| `/manager/employees/[employeeId]/edit`            | Edit/disable/assign employee                              | Manager, scoped                          |
| `/manager/employees/[employeeId]/pin`             | Set or reset employee PIN                                 | Manager, scoped and audited              |
| `/manager/managers`                               | Manager membership list                                   | Owner                                    |
| `/manager/managers/[managerId]`                   | Role, status, and location assignments                    | Owner                                    |
| `/manager/sops`                                   | SOP library with search, filters, and status tabs         | Manager, scoped                          |
| `/manager/sops/new`                               | Create a manual or later video-assisted draft             | Manager, scoped                          |
| `/manager/sops/[sopId]`                           | SOP overview and current publication state                | Manager, scoped                          |
| `/manager/sops/[sopId]/edit`                      | Edit current draft or create draft from published version | Manager, scoped                          |
| `/manager/sops/[sopId]/steps`                     | Ordered step editor                                       | Manager, scoped                          |
| `/manager/sops/[sopId]/preview`                   | Employee-view preview                                     | Manager, scoped                          |
| `/manager/sops/[sopId]/publish`                   | Validation, change summary, retraining rule, publish      | Manager, scoped                          |
| `/manager/sops/[sopId]/versions`                  | Immutable version history                                 | Manager, scoped                          |
| `/manager/sops/[sopId]/versions/[versionId]`      | Previous-version preview                                  | Manager, scoped                          |
| `/manager/sops/[sopId]/versions/compare`          | Version comparison summary                                | Manager, scoped                          |
| `/manager/sops/[sopId]/training`                  | SOP training configuration                                | Manager, scoped                          |
| `/manager/sops/[sopId]/training/questions`        | Step and final questions                                  | Manager, scoped                          |
| `/manager/sops/[sopId]/translations`              | English/Spanish review and approval                       | Manager, scoped                          |
| `/manager/sops/[sopId]/ai`                        | Video processing status and generated draft review        | Manager, scoped                          |
| `/manager/qr`                                     | QR registry and printable sheets                          | Manager, scoped                          |
| `/manager/qr/new`                                 | Create QR destination                                     | Manager, scoped                          |
| `/manager/qr/[qrCodeId]`                          | View, print, or revoke a QR                               | Manager, scoped                          |
| `/manager/training/assignments`                   | All assignments and status tabs                           | Manager, scoped                          |
| `/manager/training/assignments/new`               | Individual or bulk assignment                             | Manager, scoped                          |
| `/manager/training/assignments/[assignmentId]`    | Assignment details                                        | Manager, scoped                          |
| `/manager/training/approvals`                     | Approval queue                                            | Manager, scoped                          |
| `/manager/training/approvals/[submissionId]`      | Evidence review and decision                              | Manager, scoped                          |
| `/manager/training/paths`                         | Training path list                                        | Manager, scoped                          |
| `/manager/training/paths/new`                     | Create path                                               | Manager, scoped                          |
| `/manager/training/paths/[pathId]`                | Path details, ordering, status                            | Manager, scoped                          |
| `/manager/training/paths/[pathId]/edit`           | Edit path requirements                                    | Manager, scoped                          |
| `/manager/qualifications`                         | Qualified, training, missing, expiring, expired views     | Manager, scoped                          |
| `/manager/qualifications/[qualificationId]`       | Qualification evidence and history                        | Manager, scoped                          |
| `/manager/checklists`                             | Checklist definitions                                     | Manager, scoped                          |
| `/manager/checklists/new`                         | Create checklist                                          | Manager, scoped                          |
| `/manager/checklists/[checklistId]`               | Checklist details                                         | Manager, scoped                          |
| `/manager/checklists/[checklistId]/edit`          | Edit definition and ordered items                         | Manager, scoped                          |
| `/manager/checklist-runs`                         | Active, incomplete, completed, and correction views       | Manager, scoped                          |
| `/manager/checklist-runs/[runId]`                 | Run evidence and review                                   | Manager, scoped                          |
| `/manager/reports`                                | Report index and filters                                  | Manager, scoped                          |
| `/manager/reports/training`                       | Employee/SOP training progress and failures               | Manager, scoped                          |
| `/manager/reports/qualifications`                 | Qualification status                                      | Manager, scoped                          |
| `/manager/reports/checklists`                     | Checklist completion                                      | Manager, scoped                          |
| `/manager/reports/approvals`                      | Approval decision history                                 | Manager, scoped                          |
| `/manager/reports/sop-versions`                   | SOP version history                                       | Manager, scoped                          |
| `/manager/print/sops/[versionId]`                 | Printable SOP/recipe card                                 | Manager, scoped                          |
| `/manager/print/training/[sessionId]`             | Printable training record                                 | Manager, scoped                          |
| `/manager/print/qualifications/[qualificationId]` | Printable qualification record                            | Manager, scoped                          |
| `/manager/print/checklists/[runId]`               | Printable checklist record                                | Manager, scoped                          |

## Employee routes

All `/employee/*` content routes require a valid employee session, an enabled employee and organization/location, and server-side target authorization.

| Route                                                   | Screen or action scope                                                  |
| ------------------------------------------------------- | ----------------------------------------------------------------------- |
| `/employee`                                             | Mobile home                                                             |
| `/employee/station`                                     | Assigned/selected primary station                                       |
| `/employee/stations`                                    | Authorized station library                                              |
| `/employee/stations/[stationId]`                        | Station SOP library                                                     |
| `/employee/sops/[sopId]`                                | Current published SOP viewer                                            |
| `/employee/recent`                                      | Recently viewed SOPs                                                    |
| `/employee/recipes`                                     | Recipe category library                                                 |
| `/employee/cleaning`                                    | Cleaning procedures                                                     |
| `/employee/opening`                                     | Opening procedures                                                      |
| `/employee/closing`                                     | Closing procedures                                                      |
| `/employee/training`                                    | Assigned, due, active, completed, failed, overdue, and updated training |
| `/employee/training/[assignmentId]`                     | Assignment summary and start/resume                                     |
| `/employee/training/[assignmentId]/session/[sessionId]` | Server-enforced training step or quiz flow                              |
| `/employee/training/[assignmentId]/result`              | Attempt/result/approval state                                           |
| `/employee/training/[assignmentId]/changes`             | Published “What Changed” review                                         |
| `/employee/approvals/[submissionId]`                    | Correction note and replacement evidence flow                           |
| `/employee/qualifications`                              | Earned, in-progress, expiring, and retraining status                    |
| `/employee/qualifications/[qualificationId]`            | Qualification details                                                   |
| `/employee/checklists`                                  | Available and active checklists                                         |
| `/employee/checklists/[checklistId]/start`              | Start a checklist run safely                                            |
| `/employee/checklist-runs/[runId]`                      | Complete, pause, resume, or submit a run                                |
| `/employee/notifications`                               | In-app notifications                                                    |
| `/employee/profile`                                     | Identity, language, and session actions                                 |

## Transport conventions

- Reads may use server-rendered pages or typed route handlers; mutations use validated server actions or API handlers with CSRF/same-origin protection.
- API endpoints, if exposed, live under `/api/v1/` and mirror service capabilities rather than page URLs.
- Every list accepts bounded pagination and allow-listed filters. Export routes apply the same authorization and filter validation.
- Media delivery URLs are short-lived or application-authorized; object keys are never treated as permission.
- Redirect destinations after login are server-issued and constrained to safe internal routes.
