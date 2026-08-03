# Handoff: StationSnap — employee SOP execution + Training Mode

## Overview

StationSnap is a QR-first mobile web app for restaurant crews. An employee scans a station QR
code, follows a procedure one step at a time, submits a completion photo, and signs with a
4-digit PIN. A manager records a task once on video, edits the AI-drafted steps, publishes it,
reviews submissions, and runs Training Mode — Learn / Guided / Test / Demonstration — which
qualifies employees for a station.

The design covers 20 screens across 5 review turns:

| Turn | Options | Area |
| --- | --- | --- |
| 1 | 1a, 1b, 1c | Employee QR→proof→PIN flow (one-step-at-a-time and scrolling-list variants), manager dashboard/review/record |
| 2 | 2a, 2b, 2c | Correction loop, station QR card + printable procedure sheet, completion history |
| 3 | 3a–3g | Business setup, roster + PINs, task assignment, Spanish review, quiz builder/taker, employee home, notifications |
| 4 | 4a–4e | Training screen + station path, the four-mode runner, per-SOP training settings, path builder, training dashboard |
| 5 | 5a, 5b | Demonstration verification, mid-training SOP update |

## About the design files

The files in this bundle are **design references created in HTML** — prototypes showing the
intended look and behavior, not production code to copy. The task is to **recreate these designs
in the target codebase's existing environment** (React Native, React web, SwiftUI, etc.) using
its established patterns, routing and component library. If no environment exists yet, pick the
framework that fits the product — note that the employee side is deliberately *mobile web, no
install*, so a PWA or server-rendered web app is the intended target for that half.

`StationSnap.dc.html` is one file containing all 20 screens side by side on a canvas. Each screen
is a `<section>`/option with a visible id badge (`1a`, `4b`, …). Every screen is interactive:
timers run, gates block, the theme toggle persists.

## Fidelity

**High fidelity.** Final colors, type, spacing, motion and copy. Recreate pixel-accurately using
the codebase's own primitives. All values come from the Nocturne design system
(`nocturne/styles.css` in this bundle) — map its tokens onto the target system's tokens rather
than hard-coding hexes a second time.

## Screens / Views

Screen geometry is common to all of them unless noted:

- Device: iPhone-class viewport, 393×852 CSS px content area; the design canvas renders each at
  an 874px-tall screen inside a bezel.
- Root: `display:flex; flex-direction:column`, background `--color-bg`, text `--color-text`,
  font `--font-body` (Inter).
- Padding: `66–74px` top (clears the status bar), `18–20px` sides, `34–40px` bottom.
- Vertical rhythm: `gap: 14–16px` between blocks.
- Primary action is pinned to the bottom with `margin-top:auto` — one-handed reach.

### Kitchen constraints (these drove every size — do not shrink them)

- Minimum touch target **60px** tall for primary actions, **44px** for chips and secondary controls.
- Instruction type **26–28px**; no critical text below **15px**; meta labels 12–13px.
- No audio dependency; no hover-only affordances; high contrast in both themes.
- A task should be completable in under 60 seconds of screen time.

### 1a — Employee: scan → station → procedure → proof → PIN → done

Seven states in one screen (`emp`: `scan | station | proc | photo | pin | done | checklist | recipe`).

- **Scan landing** — accent dot + "QR SCANNED" eyebrow (12px, `.1em` tracking, uppercase,
  `--color-accent`); station name 38px/1.05 weight 500 letter-spacing `-.02em`; a
  gradient-terminated 1px rule (`transparent → --color-divider → transparent`, 40px fades);
  primary card button 82px tall, radius 16, 1px `--color-accent` border on a 12% accent tint,
  hover 20%; two 72px secondary buttons in a 12px-gap row.
- **Station** — 52px back button (radius 14, 1px `--color-divider`); "DUE NOW" eyebrow; two task
  cards (18px padding, radius 16; the due one accent-bordered); `.tag` chips; a list of 64px
  guide rows with a 20px `→` in the accent.
- **Procedure step** — top bar: 48px back, a 6-segment progress bar (5px tall, 3px radius, filled
  segments `--color-accent`, transitions `width/background .3s`), and a 56×48 EN/ES toggle
  (accent outline). Step number in a 46px accent-outlined square; step text 28px/1.2 weight 500;
  a 190px image slot; optional warning panel (`--color-accent-900` fill, `--color-accent-700`
  border, `--color-accent-200` text, ▲ glyph) and optional timer panel (32px mono-ish digits,
  112×56 start/pause button). Bottom: 66px "Done · next →".
- **Photo proof** — two 132px columns ("Approved" vs "Yours"; the empty one is a 1px dashed
  `--color-neutral-700` placeholder). After capture, a verdict panel animates in after 700ms.
  76px "Take photo", then a 66px "Sign and submit →".
- **PIN** — 4 dots (20px, 1.5px accent ring, filled when entered); 3×4 keypad, keys 68px tall,
  radius 15, 26px numerals; submit disabled (opacity .45) until 4 digits.
- **Done** — 64px accent ring with a 34px glow, "Submitted" at 34px, a 4-row receipt
  (label `--color-neutral-500` / value `--color-text`), then next-task and back buttons.

### 1b — Employee: same procedure as a scrolling checklist

Five tap-to-tick step cards (34px number chip that becomes a filled ✓), a persistent timer panel,
a reference photo, one bottom CTA. The tradeoff note is part of the design: list = speed for
people who know the task, 1a = training.

### 1c — Manager: dashboard → review → record

- **Dashboard** — three stat tiles (30px figures), two approval cards with 74px thumbnails,
  a recent list of 48px rows, and a bottom "＋ Record a procedure" ghost button.
- **Review** — side-by-side 150px approved/submitted photos, an auto-check line, approve (70px)
  and request-correction (60px). Requesting a correction reveals reason chips + a note textarea.
- **Record** — video slot, then three states: idle → analyzing (1.4s, glowing dot) → draft steps
  with per-step ✎ buttons → published. Copy is explicit that nothing publishes on its own.

### 2a — Employee: correction received

Three states (`corr`: `note | redo | sent`). The manager's note sits in an accent-900 panel at
18px/1.4. Redo shows only the two flagged steps, requires a new photo, then confirms.

### 2b — Station QR card + printable procedure sheet

The one place the palette inverts: **paper is always light**, in both themes.

- QR card: 300px wide, `--color-surface`, radius 16, `--shadow-md`; QR plate `#f3f5fe` with a
  `--color-accent-800` border; modules drawn as a 21×21 grid of `#292b31` squares.
- Sheet: 620px wide, `#f3f5fe` ground, `#292b31` ink, `#4b4f5c` captions, `#b2b6ca` rules,
  radius 8, `--shadow-lg`. Title 34px; a 104px QR block top-right; a boxed warning; a two-column
  body (steps left, approved photo + materials right); a footer stating paper is a backup only.
- **Implementation note:** the QR art in the prototype is a deterministic placeholder, not a
  scannable code. Generate real codes server-side (see the API contract) and render the returned
  SVG/PNG. Keep the ink literals — do not theme them.

### 2c — Manager: completion history

Today/This week/Month chips plus per-employee chips, a count line, then day-grouped rows with a
56px thumbnail, task, `who · station · time`, and a status pill whose border goes accent when the
row needs attention.

### 3a–3g — Setup and everyday manager/employee screens

- **3a Setup wizard** — 4-step progress bar; business → location → station multi-select chips →
  a confirmation with a popping ✓. Back is always available.
- **3b Roster** — 46px initial avatars (accent-700 ring), station subtitle, PIN in monospace at
  19px with `.14em` tracking. Add-employee panel generates a PIN and can reroll it. Copy states
  PINs sign completions and are not logins.
- **3c Assign task** — who / when chip groups, then two 66px toggle rows (54×32 track, 26px knob,
  track cross-fades over 250ms), a live summary line, and a 70px assign button.
- **3d Spanish review** — per-line English (14px muted) above Spanish (17px), Edit + Approve
  buttons per line, a progress bar, and a publish button gated on all lines being approved.
- **3e Training questions** — Manager/Employee segmented tabs; the manager view lists draft
  questions with the correct answer; the employee view scores in place and reveals ✓ / ×.
- **3f Employee home** — greeting, due-now cards, a scan/my-station pair of 96px tiles, and a
  recently-viewed list. This is the non-QR entry point.
- **3g Notifications** — 9px unread dot, title 18px, body 14px, time 12px; tap marks read;
  a mark-all toggle. Copy notes v1 is email + in-app only.

### 4a–4e — Training Mode

- **4a Employee training screen** — the station path card (progress bar + 4 SOP rows with tick
  boxes + the qualification sentence), then All / Assigned / In progress / Overdue / Completed
  filters over the assignment list. States carry distinct chip colors; completed rows drop to 60%.
- **4b The runner** — a 4-tab segmented control:
  - *Learn* — video + the full step list, read-only. Records that it was reviewed.
  - *Guided* — one step at a time with a per-step **requirement gate**: a confirm checkbox, a
    60-second contact timer, or a proof photo. Next is disabled (opacity .45, `disabled`) until
    the gate is satisfied, and a line of copy always says why. Finishing routes to the test.
  - *Test* — one question at a time, attempt counter in the header, then a result screen with the
    score at 56px. Pass → Demonstration. Fail → back to Learn, attempt incremented.
  - *Demonstration* — record → submit → waiting-on-verification.
- **4c Per-SOP training settings** — four toggles (required, in order, test at the end, manager
  approval) and four chip groups (assign by employee/role/station/location/team, passing score,
  attempts, retrain interval). A summary line composes the choices into a sentence.
- **4d Path builder** — multi-select SOP list plus the qualification rule.
- **4e Training dashboard** — assigned / overdue / to-verify tiles, per-employee progress bars,
  and a qualifications & retraining list.

### 5a — Manager: verify a demonstration

Video, then four confirmation checkboxes that gate the pass button; passing shows a "Qualified for
Grill" panel with the retrain date. Rejecting opens redo chips + a note and spends an attempt.

### 5b — Employee: the SOP changed mid-training

Before/after pairs for the two changed steps (old struck through at 13px, new at 17px), a note
explaining that progress reset and qualification is on hold, and status chips.

## Interactions & behavior

**Gating rules that must survive implementation**

1. Required steps cannot be skipped — Next is inert until the step's requirement is met
   (`confirm` / `timer` / `photo`). Reflect this in both the disabled attribute and the copy.
2. The test cannot be passed below the configured passing score; each submission consumes an
   attempt; exceeding the attempt limit requires a manager reset.
3. Demonstration requires manager verification before qualification.
4. Closing checklist submit is disabled until all items are ticked.
5. Translation publish is disabled until every line is approved.
6. Republishing an SOP resets in-flight training progress on that SOP.

**Motion** (all in the prototype's `<style>` block)

| Where | Animation |
| --- | --- |
| Screen change | `ss-inA/ss-inB` — 10px rise + fade, 300–450ms `cubic-bezier(.2,.8,.2,1)` |
| Step advance | `ss-slideA/ss-slideB` — 16px horizontal slide + fade, 340ms, same easing |
| Success marks | `ss-pop` — scale .82 → 1.06 → 1, 340ms |
| Running timers | `ss-pulse` — opacity 1 → .35, 1s, infinite |
| Analyzing dot | `ss-glow` — 10px → 22px accent glow, 1.4s, infinite |
| Buttons | hover `brightness(1.1) saturate(1.04)`; active `scale(.975)`; 180ms |
| Progress bars | `width .5s cubic-bezier(.2,.8,.2,1)` |
| Toggles | track `background .25s` |
| Reduced motion | all durations collapse to .01ms under `prefers-reduced-motion:reduce` |

The A/B keyframe pairs exist so an animation *restarts* when the step index changes; in a
framework, use a changing `key` on the animated node instead.

**Theming** — a light/dark toggle is pinned top-right of the canvas. It rewrites the Nocturne
token variables on `document.documentElement` and persists to `localStorage['stationsnap-theme']`.
In production, hang the token set off a `data-theme` attribute and honor
`prefers-color-scheme` on first load. Paper artifacts (2b) never theme.

**Localization** — EN/ES toggles are live on the procedure and recipe screens; all step, checklist
and recipe strings carry both languages. Copy tone is terse and directive: "Two 3-oz patties.
Press 10 sec."

## State management

Screen-level state in the prototype (one component; split per route in production):

| Concern | State | Notes |
| --- | --- | --- |
| Employee flow | `emp`, `step`, `lang` | screen router + step index |
| Timers | `left`, `running`, `tLeft`, `tRun`, `tTimerDone` | 1s interval, cleared on unmount |
| Proof | `photo`, `verdict`, `tPhoto` | verdict is a delayed auto-check result |
| Signing | `pin` | 4 chars, never persisted client-side in production |
| Checklists | `checked[]`, `listDone[]` | |
| Manager | `mgr`, `note`, `reason`, `approved`, `rec` | `rec`: idle → analyzing → ready → published |
| Correction | `corr`, `corrPhoto` | |
| History | `histWhen`, `histWho` | server-side filters in production |
| Setup | `setup`, `stations[]`, `roster[]`, `adding`, `newPin` | |
| Assignment | `assignWho`, `assignWhen`, `reqPhoto`, `reqApproval` | |
| Translation | `esApproved[]` | |
| Training | `trFilter`, `trMode`, `tStep`, `tConfirm[]` | `trMode`: learn/guided/test/demo |
| Testing | `tqIndex`, `tqPick`, `tqRight`, `tqAttempt`, `tqResult` | scoring must move server-side |
| Verification | `ver`, `verFlags[]` | |
| Theme | `light` | persisted |

**Move to the server:** test scoring and pass/fail, attempt counting, PIN validation, gate
satisfaction (a client that says "photo taken" is not proof), qualification state, and retrain
scheduling. The client should render server-declared requirements, not decide them.

## Data fetching

See `api-contract.md` in this folder for the full endpoint list, payload shapes and the
offline/queueing rules. `data-shapes.js` holds the fixtures the prototype uses, annotated with
JSDoc typedefs — it is the seam: replace each exported constant with a fetch of the matching
endpoint and the screens keep working.

## Design tokens

From Nocturne (`nocturne/styles.css`). Dark is the default; the light column is the override map
in the prototype's logic class.

| Token | Dark | Light |
| --- | --- | --- |
| `--color-bg` | `#161826` | `#f3f5fe` |
| `--color-surface` | `#232532` | `#ffffff` |
| `--color-text` | `#e9e9ed` | `#292b31` |
| `--color-accent` | `#9184d9` | `#5d5294` |
| `--color-divider` | `#e9e9ed` @16% | `#292b31` @14% |
| `--color-neutral-100…900` | `#f3f5fe` → `#292b31` | inverted, muted steps darkened to `#4b4f5c`/`#565a68` for AA |
| `--color-accent-100…900` | `#f5f4ff` → `#2b2741` | inverted |
| `--shadow-sm/md/lg` | tuned to the dark ground | recomposed on `rgba(41,43,49,·)` |

Type: Inter for both heading and body roles; headings never above weight 500 — hierarchy is size
and space. Scale in use: 56 / 38 / 34 / 32 / 30 / 28 / 26 / 22 / 19 / 17 / 15 / 13 / 12 / 11 px.

Radius: 22 (pill), 16 (primary action / card), 14 (control), 12 (chip / thumbnail), 10, 8, 6 (paper).
Spacing: 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24 / 34 px (Nocturne's 0.7× density scale).

Accessibility floor: body-size text ≥4.5:1 in both themes; accent-on-ground is ≥3:1 and is used
for lines, chrome and large text — never paragraph copy (use `--color-accent-300` on dark).

## Assets

- **Photography: none supplied.** Every photo position is an `<image-slot>` drop target with a
  distinct id and a placeholder describing what belongs there — approved reference shots, step
  clips, submissions, demonstration video. Replace with real media URLs.
- **Icons:** the prototype uses text glyphs (→ ← ✓ ▲ ◉ ▣ ✎ ◷ ＋). Nocturne specifies
  **Phosphor Icons** — substitute Phosphor equivalents in production.
- **QR codes:** placeholder art. Generate real codes (see API contract).
- **Fonts:** Inter.

## Files

| File | What it is |
| --- | --- |
| `StationSnap.dc.html` | All 20 screens, interactive. The design reference. |
| `api-contract.md` | Endpoints, payloads, offline rules. |
| `data-shapes.js` | JSDoc typedefs + the prototype's fixtures. The data seam. |
| `ios-frame.jsx` | The device bezel used to present the screens — presentation only, not part of the product. |
| `image-slot.js` | The drop-target placeholder component — replace with real image rendering. |
| `nocturne/styles.css` | The design system tokens and component classes. |
| `nocturne/readme.md` | The design system's own guidance. |
