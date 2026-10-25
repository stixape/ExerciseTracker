# ExerciseTracker architecture

Observed on 2026-10-25 from source at base commit c58a8ab and existing documentation.

## Purpose and flow

A mobile-first, local-first workout PWA. Users edit weekly plans, log weighted/timed/band sets, use optional rest countdowns, review progress and export/import records.

- src/main.tsx mounts React inside BrowserRouter and registers the generated service worker only in production.
- src/App.tsx contains the main shell, dashboard, plan, progress and settings routes. src/features/workout/WorkoutPage.tsx owns the active-workout screen.
- src/app/TrackerContext.tsx loads the shared state, serializes snapshot writes and reports persistence/recovery failures.
- src/domain/ contains types, default plans, session/workout progression, rest rules, band operations, analytics, validation and export logic.
- src/lib/offlineDb.ts uses Dexie/IndexedDB as the canonical app-data snapshot. Versioned migrations preserve older installations. appDataSchema.ts and localData.ts validate and restore stored/imported data, including legacy shapes.
- src/lib/alarm.ts supports workout alarm feedback. Browser interaction/audio restrictions still apply.

Data flows from UI actions through domain transformations into the shared context and validated local snapshot. JSON is the backup/restore path; CSV is an export format. The current settings include hiding rest countdowns and managing band colours. Automatic account recovery and cross-device sync are absent.

## Build and delivery

Vite/TypeScript build the app. scripts/prepare-pages-build.mjs prepares route fallback and a content-versioned service worker that precaches emitted files. .github/workflows/deploy.yml verifies pull requests; main pushes can verify and deploy the tested artifact to GitHub Pages. Unit tests live beside source, browser smoke tests under e2e/, and offline verification in scripts/verify-pwa.mjs.

## Boundaries and constraints

Workout data stays in browser storage unless explicitly exported. Browser data loss requires an exported backup for recovery. Pages projects share an origin; path separation is not a storage-security boundary. No authentication/backend/sync service is implemented. Changes to persistence require migration and import-compatibility care.

See README.md, docs/offline-support.md, docs/sync-strategy.md and package.json. PROJECT_PLAN.md contains earlier planning and must be checked against source for current UI behavior.
