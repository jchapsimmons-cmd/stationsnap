# StationSnap Design Component Map

## Design status

No approved design screens are available as of 2026-08-02. This map connects required product screens to routes, reusable components, data, permissions, states, and responsive behavior. Visual properties—typography, spacing, colors, radii, shadows, iconography, imagery, and exact navigation—remain `TBD: approved design` and must not be treated as approved.

All screens require a focus-visible state, keyboard-operable controls where relevant, labeled inputs, touch targets appropriate for mobile use, semantic headings, non-color-only status communication, and announced validation/status messages.

## Shared shells and primitives

| Area | Planned reusable components |
| --- | --- |
| Global | `AppShell`, `AuthBoundary`, `PageHeader`, `Breadcrumbs`, `LoadingPanel`, `EmptyState`, `ErrorPanel`, `ToastRegion`, `OfflineBanner` |
| Inputs | `Button`, `IconButton`, `TextInput`, `NumberInput`, `PinInput`, `Select`, `Textarea`, `Checkbox`, `Toggle`, `DateTimeInput`, `SearchInput` |
| Data display | `Card`, `StatusBadge`, `DataTable`, `MobileList`, `FilterBar`, `Tabs`, `Pagination`, `ProgressIndicator`, `MetricCard` |
| Overlays | `Modal`, `Drawer`, `ConfirmationDialog`, `FileUpload`, `MediaViewer` |
| SOP | `SopCard`, `SopFilters`, `StepCard`, `StepEditor`, `MaterialsList`, `WarningCallout`, `Timer`, `MediaPlayer`, `VersionBadge` |
| Training | `AssignmentCard`, `TrainingStepper`, `QuestionCard`, `EvidenceUpload`, `ScoreSummary`, `ApprovalHistory` |
| Checklists | `ChecklistCard`, `ChecklistItem`, `RunProgress`, `EvidenceThumbnail` |

## Manager screen families

| Screen / routes | Main components | Required data | Permission | Loading / empty / error | Mobile behavior |
| --- | --- | --- | --- | --- | --- |
| Manager authentication (`/manager/login`, recovery routes) | Auth card, email/password or secure-link form, status message | Auth method, recovery token state | Signed-out only | Submit spinner; recovery confirmation; invalid/expired/disabled/rate-limited errors | Single column, keyboard-safe, no horizontal scroll |
| Dashboard (`/manager`) | Manager shell, filters, metric cards, activity list | Scoped aggregates, timezone, recent events | Manager scoped; Owner org-wide | Skeleton cards; helpful no-activity state; partial-query error handling | Cards stack; filters in drawer; no chart dependency |
| Organization settings (`/manager/settings/organization`) | Form sections, logo upload, selects, status dialog | Organization, logo, locales, timezone | Owner writes | Field skeleton; missing logo is valid; upload/validation/conflict errors | One-column form; sticky save only if design approves |
| Locations/stations (`/manager/settings/locations*`, `/manager/settings/stations*`) | Table/mobile list, filter bar, form, image upload, order control, confirmation | Scoped locations, assignments, stations | Owner all; Manager assigned locations | Row skeletons; zero-results and no-record states; not-found/forbidden/conflict | Table becomes cards; actions menu; reorder touch accessible |
| Managers/employees (`/manager/managers*`, `/manager/employees*`) | Search, filters, people list, profile form, PIN reset dialog, status badges | Memberships, grants, employee/job/station data, training summary | Owner manager-admin; Manager scoped employees | Skeleton; no matches; disabled status; duplicate/permission errors | Cards instead of dense table; secure PIN flow avoids exposure |
| SOP library (`/manager/sops`) | Status tabs, search/filter bar, SOP cards/table, pagination | Scoped SOP summaries and publication status | Manager scoped | Tab skeleton; distinct no-SOP/no-match states; recoverable fetch error | Filter drawer; card list; primary create action remains reachable |
| SOP draft/editor (`/manager/sops/new`, `[sopId]/edit`, `/steps`) | Metadata form, autosave indicator, file upload, sortable step editor, dialog | Draft, steps, files, categories, locations/stations, save revision | Manager scoped | Initial skeleton; empty step prompt; upload/save/validation/conflict errors | One step expanded at a time; touch reorder plus move buttons; autosave status visible |
| SOP preview/publish/versioning (`preview`, `publish`, `versions*`) | Employee preview, validation checklist, change summary, version list/compare, retraining form | Draft validation, immutable versions, diff summary | Manager scoped | Preview skeleton; no prior versions; publication/permission/stale-draft errors | Preview uses employee viewport; compare stacks changed fields |
| Training configuration (`[sopId]/training*`) | Mode selector, requirement toggles, numeric inputs, question editor, reorder | Version steps, config, questions/choices | Manager scoped | Form skeleton; no questions is valid; rule-validation/save-conflict errors | Progressive sections; sticky section status; reorder has buttons |
| AI generation and translations (`ai`, `translations`) | Job status, generated step review, translation matrix/editor, approval badge | Source media/content, job attempts/output, translation revisions | Manager scoped | Processing progress; untranslated state; provider/retry/validation errors | Review one field/step at a time; original and translation stack |
| QR registry (`/manager/qr*`) | QR list, target picker, QR preview, revoke/print dialog | Authorized targets, token status, scan summary | Manager scoped | Preview skeleton; no QR state; revoked/target-unavailable/generation errors | Cards and full-width scannable preview |
| Assignments (`/manager/training/assignments*`) | Status tabs, target builder, due-date form, assignment list | Employees/roles/stations/locations, SOP versions/config, assignments | Manager scoped | Resolution progress; no assignments; duplicate/invalid target/time errors | Multi-select in full-screen drawer; cards by due status |
| Approval queue/review (`/manager/training/approvals*`) | Queue list, evidence gallery/player, attempt summary, decision form/history | Submission, evidence, quiz, attempts, employee/location/SOP | Manager scoped | Evidence skeleton; empty queue; expired URL/media/permission errors | Evidence is swipe/stack friendly; decision controls remain below full context |
| Paths/qualifications (`/manager/training/paths*`, `/manager/qualifications*`) | Path editor, ordered SOP list, status tabs, qualification list | Path requirements, completion facts, qualifications/expiry | Manager scoped | No-path/no-qualification states; invalid order/missing requirement errors | Ordered cards; filters in drawer; expiration status prominent |
| Checklist definitions/runs (`/manager/checklists*`, `/manager/checklist-runs*`) | Definition form, sortable items, recurrence form, run filters, evidence review | Checklist/items/recurrence, runs/progress/evidence | Manager scoped | No definitions/runs; incomplete evidence; recurrence/permission errors | Definition items collapse; run cards show progress and due context |
| Reports/activity (`/manager/reports*`, `/manager/activity`) | Filter bar, paginated table/mobile list, export/print actions | Authorized aggregates and rows | Manager scoped | Query skeleton; no-results state; bounded-filter/export errors | Summary first; rows become cards; filters persist safely |
| Notifications (`/manager/notifications`) | Notification list, unread marker, mark-read action | Recipient notifications and destinations | Current manager | Skeleton; all-caught-up state; invalid destination error | Compact chronological list with large targets |
| Print views (`/manager/print/*`) | Print header, record sections, QR/media, page-break groups | Exact authorized immutable record | Manager scoped | Print preparation; missing media fallback; forbidden/not-found | Screen preview responsive; print CSS controls pagination |

## Employee screen families

| Screen / routes | Main components | Required data | Permission | Loading / empty / error | Mobile behavior |
| --- | --- | --- | --- | --- | --- |
| Access and PIN login (`/employee/access`, `/employee/login`) | Access form, employee selector/number, PIN pad, lockout status | Organization/location access context, safe employee choices | Public until authenticated | Submit spinner; no employees; invalid/locked/disabled/rate-limit errors | One-handed numeric input; preserves safe QR destination |
| Home/stations (`/employee`, `/employee/station`, `/employee/stations*`) | Employee shell, station card, category shortcuts, assigned items | Employee/location, station access, published SOP summaries | Employee scoped | Skeleton cards; no assigned station/content; offline/access errors | Mobile-first cards; critical shift actions above fold; tablet grid |
| SOP libraries (`recipes`, `cleaning`, `opening`, `closing`, `recent`) | Search, category tabs, SOP cards | Authorized current published SOPs and recent views | Employee scoped | List skeleton; no results/recent items; network/archived/access errors | Large list rows, simple filters, incremental loading |
| SOP viewer (`/employee/sops/[sopId]`) | Header, materials, warning callout, step cards, media, timers, language switch | Current version, steps/media, translations, access | Employee scoped | Progressive skeleton; missing optional media fallback; unavailable/archived/network errors | Single column, readable during shift, media constrained, controls reachable |
| Training list/detail (`/employee/training*`) | Status sections, assignment cards, due badge, change summary | Employee assignments, due state, current published changes | Employee only | Skeleton; no assignments; expired/maximum-attempt/session errors | Due items first; resumable sessions prominent |
| Training engine (`session/[sessionId]`) | Training stepper, step content, timer/player, question, evidence upload, save status | Server session state, config, step progress, signed media | Session owner only | Resume skeleton; upload retry; offline, stale action, expired session errors | One task per screen; safe-area actions; state survives refresh |
| Training result/correction (`result`, `/employee/approvals*`) | Score/result, approval status, manager note, evidence history/replacement | Attempts, decision history, correction requirements | Session owner only | Waiting state; no correction; evidence/session errors | Clear status and next action; history collapsible |
| Qualifications (`/employee/qualifications*`) | Qualification cards, progress requirements, expiry badge | Employee awards, paths, supporting completion | Employee only | Skeleton; none earned/in progress; access error | Cards ordered by action/expiry priority |
| Checklists (`/employee/checklists*`, `/employee/checklist-runs*`) | Checklist cards, item flow, timer, proof upload, progress/save status | Available definitions, run snapshot and progress | Employee/location scoped | No available checklists; upload/offline/submitted/conflict errors | One item at a time or short list per design; persistent progress |
| Notifications/profile (`/employee/notifications`, `/employee/profile`) | Notification list, language selector, logout | Employee notifications, safe profile/session data | Employee only | All-caught-up; language-save/session errors | Simple list/form, language change preserves route/progress |
| QR states (`/q/[token]`, `/q/invalid`) | Resolve progress, identity prompt, status panel | QR status and authorized target descriptor | Token validation plus target authorization | Validating; invalid/revoked/archived/missing-access/network states | Immediate, legible, one primary recovery action |

## Design reconciliation checklist

When approved designs arrive, inventory every frame and state, attach its source identifier to the matching row above, and record deviations. Verify all typography, spacing, color, responsive breakpoints, navigation, control variants, media ratios, dialogs, and state screens. Any required product interaction absent from the designs should use approved primitives and be sent for design review rather than silently improvised.

