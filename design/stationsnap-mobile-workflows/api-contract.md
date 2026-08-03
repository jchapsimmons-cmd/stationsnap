# StationSnap — API contract

The shape the prototype's screens expect. Every endpoint is scoped to a location unless noted.
`data-shapes.js` carries the same shapes as JSDoc typedefs plus the fixtures currently rendering.

Conventions: JSON over HTTPS; ISO-8601 UTC timestamps; ids are opaque strings; list endpoints
return `{ items, nextCursor }`; the employee client is unauthenticated-by-QR and identifies a
person only at signing time (see *Identity*).

---

## Identity

The employee side has **no login**. A station QR resolves to a public station page; a person is
identified only when they sign a completion with a 4-digit PIN. PINs are per-location, not
secrets, and must never be a session credential.

- `GET /s/{stationToken}` → `Station` + the current `Assignment[]` for now. The token is what the
  QR encodes; rotating it invalidates printed codes, so keep it stable across SOP republishes.
- `POST /completions/{id}/sign` → `{ pin }` → `{ ok, employee }`. Server validates; rate-limit and
  lock after repeated failures. Never validate a PIN client-side.
- Manager side uses normal authenticated sessions.

## Org & setup (3a, 3b)

- `POST /businesses` → `{ name, ownerName }`
- `POST /locations` → `{ businessId, name, address }` → `Location`
- `POST /locations/{id}/stations` → `{ names: string[] }` → `Station[]` (each with a
  `qrToken` and a generated `qrUrl`)
- `GET /locations/{id}/employees` → `Employee[]`
- `POST /locations/{id}/employees` → `{ name, stationId }` → `Employee` (server generates `pin`)
- `POST /employees/{id}/pin/rotate` → `Employee`

## Procedures (1c, 3d)

- `GET /stations/{id}/procedures` → `Procedure[]`
- `GET /procedures/{id}` → `Procedure` including `steps[]` and `translations`
- `POST /procedures` (multipart: video) → `{ jobId }` — starts the AI draft
- `GET /jobs/{jobId}` → `{ status: 'analyzing'|'ready'|'failed', procedureDraft? }`
  (the prototype's analyzing state is a stand-in for polling or a socket)
- `PATCH /procedures/{id}` → step edits, warnings, amounts, equipment settings, timers
- `POST /procedures/{id}/publish` → `Procedure` with an incremented `version`.
  **Publishing must not change the station's `qrToken`.** It must emit
  `procedure.updated` (see *Events*) and reset in-flight training on that SOP (5b).
- `GET /procedures/{id}/translations/es` → `TranslationLine[]`
- `POST /procedures/{id}/translations/es/publish` — rejected unless every line is `approved`

## Print (2b)

- `GET /stations/{id}/qr.svg?size=…` → scannable QR for the card
- `GET /procedures/{id}/sheet.pdf` → the printable sheet, or return the data and render client-side

## Tasks & completions (1a, 1b, 2a, 2c, 3c)

- `POST /assignments` → `{ procedureId, target: {type: 'employee'|'role'|'station'|'location'|'team', id}, dueAt, recurrence, requirePhoto, requireApproval }`
- `GET /stations/{id}/assignments?when=now` → `Assignment[]`
- `POST /completions` → `{ assignmentId, stepResults[], photoIds[], startedAt, finishedAt }` → `Completion` (status `pending_signature`)
- `POST /completions/{id}/sign` → see *Identity* → status becomes `submitted` or `awaiting_approval`
- `GET /locations/{id}/completions?when=&employeeId=&stationId=` → `Completion[]` (2c filters are server-side)
- `POST /completions/{id}/approve` → `{ note? }`
- `POST /completions/{id}/request-correction` → `{ reasons: string[], note }` → status `correction_requested`,
  emits `completion.correction_requested` to the employee (2a)
- `POST /completions/{id}/resubmit` → `{ photoIds[], stepResults[] }`

**Photo comparison.** The "looks correct" verdict in 1a/1c is an assist, never a gate. Return it as
`{ verdict: 'match'|'differs'|'unknown', confidence }` and keep the manager's decision authoritative.

## Media

- `POST /uploads` → presigned URL → `{ mediaId, url }`. Photos and video upload directly to storage;
  the client sends only `mediaId`s. Capture must work on a phone camera in a bright kitchen —
  compress client-side, but keep the original for manager review.

## Training (4a–4e, 5a, 5b)

- `GET /procedures/{id}/training-settings` → `TrainingSettings`
- `PUT /procedures/{id}/training-settings` → `TrainingSettings`
  (`required`, `inOrder`, `quizEnabled`, `requireApproval`, `assignBy`, `passingScore`,
  `attemptLimit`, `retrainInterval`)
- `GET /stations/{id}/training-paths` → `TrainingPath[]`
- `PUT /training-paths/{id}` → `{ name, procedureIds[] }`
- `GET /employees/{id}/training` → `TrainingAssignment[]` — powers 4a's filters
  (`assigned | in_progress | overdue | completed | updated`)
- `POST /training-runs` → `{ trainingAssignmentId, mode: 'learn'|'guided'|'test'|'demo' }` → `TrainingRun`
- `POST /training-runs/{id}/steps/{stepId}/satisfy` → `{ kind: 'confirm'|'timer'|'photo'|'video', evidence }`
  → `{ satisfied: boolean, nextStepId }`
  **The server decides whether a gate is satisfied.** A timer gate should be validated against
  elapsed server time, not a client counter.
- `POST /training-runs/{id}/test` → `{ answers: [{questionId, choiceIndex}] }` →
  `{ score, passed, attempt, attemptsRemaining }` — scoring and the attempt ledger are server-side
- `POST /training-runs/{id}/demo` → `{ mediaId }` → status `awaiting_verification`
- `POST /training-runs/{id}/verify` → `{ passed, checks: string[], note? }` (5a) →
  on pass, evaluates the path and may emit `qualification.granted`
- `GET /locations/{id}/training-dashboard` → progress rows, overdue counts, pending verifications,
  qualifications and retrain dates (4e)
- `GET /employees/{id}/qualifications` → `Qualification[]` with `grantedAt` and `retrainDueAt`

## Notifications (3g)

- `GET /me/notifications` → `Notification[]`
- `POST /me/notifications/read` → `{ ids[] | all: true }`
- v1 channels: in-app + email. SMS is explicitly out of scope.

## Events (webhooks / push)

`procedure.updated` · `completion.submitted` · `completion.approved` ·
`completion.correction_requested` · `training.assigned` · `training.overdue` ·
`training.test_failed` · `training.demo_submitted` · `qualification.granted` ·
`qualification.retrain_due`

## Offline & flakiness

Kitchen wifi is unreliable and this is the app's failure mode, so treat it as a requirement:

1. A station page must be usable after first load — cache the procedure, its media and its
   translations.
2. Completions, step satisfactions and photos queue locally and sync when connectivity returns;
   show queued state honestly rather than a fake success.
3. Every mutating request takes an `Idempotency-Key` so a retried submit does not double-post.
4. If the cached procedure version is behind the server on sync, surface the 5b "SOP updated"
   screen rather than silently accepting work against a stale version.
