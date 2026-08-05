# Pipeline blocked: Phase 20 needs explicit provider decisions

**Status:** blocked, needs human input
**Blocked since:** 2026-08-05
**Next phase:** 20 (video-to-draft AI workflow, AI-assisted translation drafting, SMS notifications)

## Why this stops here

`docs/implementation-plan.md` is explicit that Phase 20 "must not start without an
explicit decision from the project owner" (implementation-plan.md:114) and that the
underlying providers are "deliberately deferred" (implementation-plan.md:49). This is
not a technical blocker the pipeline can resolve by reading code — it requires the
project owner to pick real external vendors, accounts, and credentials that don't
exist in the repo. No phase before 20 depends on these, so nothing was silently
skipped to get here; the automated pipeline has simply reached the one phase that was
always designed to stop and wait.

Phase 20 has three independent scope items, each needing its own decision:

### 1. Video-to-draft AI workflow (transcription/summarization provider)

Needed to turn an uploaded SOP video into a durable, schema-validated draft. Options:

- **OpenAI (Whisper for transcription + GPT for structured draft extraction)** — mature APIs, easy to wire behind the existing `AI output is untrusted input and must pass a versioned schema` invariant.
- **Anthropic (Claude, with a separate audio-transcription step since Claude does not transcribe audio directly)** — would pair Claude for the schema-validated draft-structuring step with a dedicated transcription provider (e.g. Whisper or a cloud STT API) upstream.
- **A cloud vendor STT + LLM combo already in use elsewhere in the org** (e.g. AWS Transcribe, Google Speech-to-Text) if there's an existing vendor relationship to reuse.

### 2. AI-assisted translation drafting (upgrading Phase 13's manual translations)

Needed to draft machine-translated SOP text for manager review, on top of the existing
manual translation/approval flow from Phase 13. Options:

- **Same LLM provider chosen for item 1** — one vendor relationship, draft translations go through the same untrusted-AI-output → schema → manager-review pipeline already built in Phase 13.
- **A dedicated translation API** (e.g. DeepL, Google Cloud Translation) — often higher translation quality for a narrower task, but a second vendor integration and credential set.

### 3. SMS notification channel (alongside Phase 16's email/in-app channels)

Needed to extend the existing notification-generation service with an SMS send path.
Options:

- **Twilio** — the most common SMS API, well-documented, straightforward to add a
  driver next to the existing SMTP driver from Phase 16.
- **A cloud provider's SMS product** (e.g. AWS SNS, Vonage) if there's already billing
  set up with that vendor.

## What's needed to unblock

The project owner needs to pick one option (or name an alternative) for each of the
three items above, plus confirm account/API-key provisioning is ready (these
credentials would need to be added to the production environment the same way
`DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, and the SMTP settings were for earlier
phases). Once documented — either as an update to `docs/implementation-plan.md`'s
decisions list or a reply wherever this pipeline's owner tracks it — delete this file
(or leave it and note the resolution) and the next tick will proceed with Phase 20.

No repo changes were made this tick beyond this file and the status breadcrumb.
