# Pipeline blocked: Phase 20 needs a durable job runner / scheduled-job host decision

**Blocked on:** 2026-08-08
**Phase:** 20 (video-to-draft AI workflow, AI-assisted translation drafting, SMS notifications)

## Why this blocks

`docs/implementation-plan.md`'s "Missing dependencies and decisions" list, item 6, has always
carried this note:

> Durable job runner and scheduled-job host. Still open; not required until Phase 20 automation
> needs it, since no phase before Phase 20 depends on background jobs.

That note is still true on `main` as of this tick. The 2026-08-06 provider-decision commit
resolved the AI/transcription/translation/SMS *vendor* choices (Anthropic, OpenAI Whisper,
Twilio), but it did not resolve **where and how background jobs actually run** — and Phase 20's
first deliverable, "the durable, schema-validated video-to-draft AI workflow," cannot be built
without answering that first.

This is a different problem than Phase 16's notification dispatch. Phase 16 got away with an
"opportunistic reconcile" pattern — a `scheduled_job_runs` idempotency table, triggered from
page-view reads, doing sub-second work (querying `domain_events` and writing `notifications`
rows). Video-to-draft is not sub-second work: uploading a training video, transcribing it via
Whisper, and structuring a draft via Claude is a multi-step, potentially multi-minute pipeline
that must survive a single Vercel serverless invocation's time limit, retry safely without
double-charging the AI providers, and let a manager come back later and see progress/failure —
none of which "run it inline on the next page load" can satisfy safely.

No file in the repo (`docs/implementation-plan.md`, `docs/data-model.md`,
`docs/route-map.md`, `docs/testing-plan.md`, `docs/production-operations.md`) names a chosen job
host, queue, or worker model. This is a real production/infrastructure decision, not something
implied by existing code, so per the pipeline's own rules it needs a human call rather than an
improvised choice baked into a merge to `main`.

## Options for the project owner

1. **Vercel Cron Jobs + a Postgres-backed job table (lowest new-vendor cost).** Reuse the
   `scheduled_job_runs`-style pattern from Phase 16, but back it with a real cron trigger
   (Vercel Cron, minimum 1-minute granularity) hitting a protected endpoint that claims and
   advances one step of a durable `video_draft_jobs` table per invocation, so a multi-minute
   pipeline is chopped into short, resumable steps instead of one long request. No new paid
   service; stays entirely inside the current Vercel + Neon stack. Tradeoff: the pipeline has to
   hand-roll retry/backoff/dead-lettering logic that a dedicated queue would give for free, and
   1-minute cron granularity adds latency to each step.

2. **Upstash QStash (HTTP-native durable queue/scheduler).** Publish a message per pipeline step;
   QStash retries with backoff and calls back into a Vercel endpoint per step, so the app never
   needs its own retry/backoff bookkeeping. Purpose-built for exactly this "chain of HTTP calls
   triggered by a queue" shape and integrates cleanly with serverless functions. Tradeoff: a new
   vendor relationship and credential (`QSTASH_TOKEN` or similar) alongside the six already
   configured for Anthropic/OpenAI/Twilio.

3. **A dedicated long-running worker process** (small always-on Node service on Fly.io/Railway/
   Render, or Vercel functions on a plan with extended max duration) polling a Postgres job table
   directly, so a single invocation can run the whole video pipeline start-to-finish without
   chopping it into steps. Tradeoff: new infrastructure to provision, deploy, and monitor beyond
   the current Vercel + Neon + Vercel Blob stack — the most capable option but the most new
   operational surface.

## What's needed to unblock

A decision from the project owner on which of the above (or an alternative) to use for Phase 20's
job runner, plus any new credentials it requires added to Vercel Production/Preview and to
`src/lib/env.ts`'s server env schema — following the same pattern used for the 2026-08-06 AI/SMS
provider decisions. Once resolved, update `docs/implementation-plan.md` item 6 and this file can
be removed (as the 2026-08-06 commit removed the prior blocker), and the next tick will proceed
with Phase 20.
