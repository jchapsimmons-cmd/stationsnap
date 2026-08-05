# Production operations

Phase 19 hardens the already-live production deployment. Hosting (Vercel), the production
database (Neon Postgres), and object storage (Vercel Blob) were selected and configured directly
against production ahead of the numbered phase sequence (see `implementation-plan.md`'s decision
#7), so this document does not re-litigate provider choice. It records the backup/retention
policy those providers must be configured to honor, the privacy documentation decision #7 also
called for, the rollback rehearsal, and how PWA metadata and release verification were added.

This document is written and maintained by the automated implementation pipeline, which has no
credentials to the live Vercel, Neon, or Blob dashboards. Everything below that can be proven from
inside this repository (env validation, migration safety, a full production-mode build/boot) has
been exercised and is re-runnable via `npm run release:check`. Everything that requires dashboard
or CLI access to the live accounts is written as a concrete, checkable policy and a runbook for
whoever holds that access, not as a claim that it has already been clicked through in production.

## Backup and retention policy

| Data                                                             | Retention                                                                                                                                                                                            | Mechanism                                                                                                                                                                                                           |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Neon Postgres — all application tables                           | Minimum 7 days of point-in-time recovery (PITR).                                                                                                                                                     | Neon's built-in PITR/branching. **Operator checklist:** confirm the project's plan and history-retention setting meet or exceed 7 days in the Neon console; upgrade the plan if it does not.                        |
| `audit_events`, `domain_events`                                  | Retained indefinitely — append-only application-level audit/business trail (see `data-model.md`); not a candidate for time-based deletion.                                                           | No deletion job exists or is planned; covered by the PITR window above like any other table.                                                                                                                        |
| Training/checklist evidence (`files`, Vercel Blob objects)       | Retained indefinitely while its owning record exists — evidence is append-only and forms the compliance/audit record behind an approval decision (see `implementation-plan.md`'s security concerns). | No automated expiry. Vercel Blob objects persist until an explicit `deleteStoredObject` call (SOP media replacement, QR reissue); there is no bucket-level TTL policy, by design.                                   |
| `manager_sessions`, `employee_sessions`, `password_reset_tokens` | Rows carry `expiresAt` and are already excluded from active use once expired (session/token lookups filter on it), but expired rows are not yet purged from the table.                               | Not a backup/retention gap (expired rows are inert and covered by the same PITR window), but flagged here as a housekeeping item for a future phase's job runner (Phase 20 introduces the first durable scheduler). |
| Local disk storage (`STORAGE_DRIVER=local`, `uploads/`)          | Development/test only.                                                                                                                                                                               | `src/lib/env.ts` now rejects `STORAGE_DRIVER=local` whenever `NODE_ENV=production` — production must use Vercel Blob, which persists independently of any single serverless instance's disk.                        |

**Restore rehearsal procedure** (to be performed periodically against the live project by an
operator with Neon console/CLI access, and logged in this file with a date and result each time it
is run):

1. In the Neon console, create a new branch from a timestamp a few minutes in the past (or from a
   specific earlier point for a real incident).
2. Point a disposable environment's `DATABASE_URL` at that branch and run `npm run db:migrate`
   against it to confirm the branch's schema is at (or can be brought to) the current migration
   head.
3. Spot-check a handful of rows against the primary branch to confirm the restore contains the
   expected pre-incident state.
4. Delete the disposable branch. Never point production `DATABASE_URL` at a restored branch
   without a deliberate, reviewed cutover.

_No restore has been logged yet — this section will gain a dated entry the first time an operator
runs the procedure above against the live project._

## Privacy documentation

Personal data StationSnap stores, and who can reach it:

- **Employees**: display name, job role, employee number, preferred language, PIN (scrypt
  one-way hashed, per `server/auth/crypto`, never logged or returned in plaintext after creation).
  Visible to managers/owners at the employee's assigned location(s); an employee sees only their
  own record.
- **Managers**: email address, password (one-way hashed), role, permitted locations. Visible to
  owners org-wide and to the manager themself; other managers cannot read another manager's
  credentials or unrelated profile fields.
- **Training/checklist evidence**: photos, videos, and free-text notes an employee submits as
  proof of completed work, plus the manager note on any approval decision. Scoped exactly like
  every other manager-facing read: owners org-wide, managers to their permitted locations, the
  submitting employee to their own submissions.
- **Audit trail**: `audit_events` records who did what, when, and from what session, excluding
  secrets and raw evidence URLs (see `implementation-plan.md`'s security concerns list). Owner/
  manager visible per the same location scoping as everything else.

No data is sold, shared with third parties for marketing, or used for purposes beyond running the
organization's own SOP/training/checklist program. SMTP email delivery (password reset, manager
notifications) and, when configured, Vercel Blob storage are the only third-party processors in
the data path; both are already covered by decision #7's resolved providers. A data-subject
deletion request is handled by disabling the employee/manager record (which already exists as a
first-class status per `data-model.md`) and, if full erasure is required, following the retention
table above for what can be purged (sessions/tokens) versus what must be retained as an audit or
compliance record (evidence, approval decisions) — full erasure of retained records is a policy
decision for the organization's owner, not an automated operation this app performs today.

## Rollback rehearsal

**Application rollback (fast, no data risk):** Vercel keeps every deployment immutably; rolling
back the running application to the previous release is an "Instant Rollback" in the Vercel
dashboard or `vercel rollback` in the CLI — no rebuild, typically seconds. This is safe at any
time because it only changes which built app is serving traffic; the database is untouched.

**Schema safety discipline (why application rollback is safe by default):** every migration
merged from this phase forward must follow an expand/contract pattern — additive first
(`ADD COLUMN` nullable or with a default, `CREATE TABLE`, `ADD INDEX`), with any destructive change
(`DROP COLUMN`, `NOT NULL` tightening, `RENAME`) landing only in a later release after the code
that depended on the old shape is gone. That guarantees the previous application version keeps
working unmodified against the current schema, which is exactly what an application-only rollback
requires. (The two `ALTER COLUMN ... SET NOT NULL` statements in `drizzle/0001_hard_squadron_supreme.sql`
predate this discipline — they ran during Phase 2, before the project went live, against an empty
database with no rollback risk.)

**Database rollback (only when schema itself must revert):** restore or branch from Neon PITR per
the restore rehearsal procedure above, then repoint `DATABASE_URL` and redeploy. This is
higher-risk and higher-effort than an application rollback and should be a last resort, exactly
because expand/contract is meant to make it unnecessary for ordinary releases.

**What has been rehearsed from inside this repository, and what still needs an operator:**

- ✅ `npm run release:check` (added this phase) proves a `NODE_ENV=production`-shaped
  configuration validates, migrates cleanly from empty with no seed step, builds, and boots to a
  healthy `/api/health` — the same forward-migration path a real deploy takes.
- ⬜ An actual Vercel "Instant Rollback" to a prior deployment, and an actual Neon branch restore,
  both require dashboard/CLI credentials this automated pipeline does not have. An operator should
  perform each at least once, note the date and outcome below, and repeat periodically (for
  example, each time a destructive migration is about to ship).

_No live rollback has been logged yet — this section will gain a dated entry the first time an
operator performs one against the live project._

## PWA metadata

`src/app/manifest.ts` (served by Next.js at `/manifest.webmanifest`) and the `icons`/`appleWebApp`
fields on `src/app/layout.tsx`'s `metadata`, plus a `viewport` export with theme-color for both
Nocturne themes, make the app installable on a home screen — important for the mobile-first
employee workflow this app targets. `public/icons/*.png` are minimal placeholders (a flat
`--color-primary`-on-`--color-bg` "S" monogram, generated by a one-off script, not committed) —
replace them with real design assets under `design/` once available, matching the existing
"visual tokens must remain easy to replace" guidance in `README.md`. No app-shell offline caching
or service worker is added in this phase; the manifest alone covers installability, and offline
support is not part of any phase's requirements.

## Production-like release verification

`npm run release:check` (`scripts/release-check.ts`) is a per-release gate, run manually before a
production deploy or a schema change, kept out of `npm run verify` for the same reason
`npm run test:e2e` is — a full build-and-boot cycle is heavier than a per-change gate needs. It:

1. Validates a `NODE_ENV=production`-shaped environment (including this phase's new production
   rules: `APP_URL` must be explicitly set and `https://`, `STORAGE_DRIVER` must be `vercel-blob`)
   with `parseServerEnv`, and separately confirms `parseSeedEnv` rejects `NODE_ENV=production`.
2. Migrates a fresh embedded PostgreSQL database from empty — no seed step, proving a real
   production deploy never carries demo/test data.
3. Runs `next build` and `next start` with that production-shaped environment.
4. Polls `/api/health` until healthy and confirms `/` renders on the freshly migrated, unseeded
   database.

A `BLOB_READ_WRITE_TOKEN` placeholder satisfies env validation without a real Vercel Blob
credential; no storage read/write is exercised by this script (upload/download paths already have
driver and route coverage in `npm run db:verify` and the unit suite).
