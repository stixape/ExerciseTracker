# ExerciseTracker architecture

Updated 2026-10-26 for the reliability implementation. Original onboarding observed base c58a8ab on 2026-10-25.

## Purpose and flow

A mobile-first, local-first workout PWA. Users edit weekly plans, log weighted/timed/band sets, use optional rest countdowns, review progress and export/import records.

- src/main.tsx mounts React inside BrowserRouter and registers the generated service worker only in production.
- src/App.tsx contains the main shell and the Workout, Plan, Progress and Settings routes. The Workout landing page previews today's plan or offers to resume. src/features/workout/WorkoutPage.tsx owns active sets, rests and completion review.
- src/app/TrackerContext.tsx distinguishes ready/empty/recovery startup, queues revision-checked commits, blocks edits during replacement, preserves pending changes on failure, and shows actionable save and backup alerts. Settings shows the latest verified backup. Cross-window notifications and resume checks supplement the database's transactional revision guard.
- src/domain/ contains types, default plans, session/workout progression, rest rules, band operations, analytics, validation and export logic.
- src/lib/offlineDb.ts uses Dexie/IndexedDB schema v7. The revision check, canonical snapshot, recovery checkpoint and completed-workout backup job commit together. A pending job reads the canonical snapshot by ID until a subsequent commit moves that payload into the job. Existing checkpoint, recovery-source and preference tables survive the upgrade.
- appDataSchema.ts and localData.ts validate and restore versioned data. JSON v6 covers notes, rest overrides and modifiers with a SHA-256 checksum. Versions 1–5 remain restorable, including v5 integrity checks. Incomplete field drafts stay in the editor.
- workoutBackups.ts processes completed-workout jobs under a browser-wide lock for this origin. It verifies the written file before deleting the oldest verified automatic copy. File order uses a folder sequence. Manual folder export and protected pre-replacement copies use fileBackups.ts. See [backup and recovery](docs/recovery.md).
- remoteBackups.ts lazily loads Supabase only on a configured dedicated origin. Authentication and immutable per-account/per-device-stream snapshot uploads require explicit opt-in and stream approval. No remote record is automatically applied locally. Reset/import/restore pauses uploads and starts a new stream on approval. Backend SQL and policy tests are under supabase/.
- src/lib/alarm.ts supports workout alarm feedback. Browser interaction/audio restrictions still apply.

Data flows from UI actions through domain transformations into the shared context and validated local snapshot. JSON is the backup/restore path; CSV is an export format. The current settings include hiding rest countdowns and archiving/reordering band colours. Remote restoration is explicit; automatic cross-device merging remains absent.

Each active workout snapshots the exercise rest overrides, notes and modifier definitions. Saving notes updates the matching live plan and active snapshot in one edit. Other modifier targets and results are keyed by field ID, while staged next targets apply only to the matching field and type at workout completion. Session history reads the recorded values and labels from the session snapshot.

Rep and time ranges store an optional upper bound on the planned set and its session snapshot. The numeric lower bound is the default performed value and progression threshold. History and CSV record the single value performed.

## Build and delivery

Vite/TypeScript build the app. scripts/prepare-pages-build.mjs prepares route fallback and a content-versioned service worker that precaches emitted files. .github/workflows/deploy.yml verifies pull requests; main pushes can verify and deploy the tested artifact to GitHub Pages. Unit tests live beside source, browser smoke tests under e2e/, and offline verification in scripts/verify-pwa.mjs.

## Boundaries and constraints

Workout data stays local unless the user chooses file backup/export or enables configured remote backup. Browser-local checkpoints are not independent copies. An empty store never silently seeds defaults; invalid migration inputs remain recoverable. Recovery after full origin loss needs an independent file or previously configured remote account, and online shell reacquisition if caches/workers were also lost.

Pages projects share an origin; path separation is not a storage-security boundary. Remote authentication is disabled on *.github.io and requires an exact configured dedicated origin. Only a publishable Supabase key may enter the build; CSP permits only that configured HTTPS API in addition to self. No backend, new origin, hosted migration or deployment is provisioned by local code changes. Ordinary offline use has no account requirement. Changes to persistence require source retention, migration and import-compatibility checks.

See README.md, docs/offline-support.md, docs/sync-strategy.md and package.json. PROJECT_PLAN.md contains earlier planning and must be checked against source for current UI behavior.
