# ExerciseTracker decisions and retained directions

Initialized 2026-10-25 from inspected code, documents and Git history. Entries below reconstruct evidence; they do not claim a previously recorded decision meeting, approver or original decision date.

## ET-001: One canonical local snapshot

Status: observed implementation.
Evidence: src/lib/offlineDb.ts, src/app/TrackerContext.tsx, README.md; commit 8277ffe (2026-08-24).
The editable plan, active workout, sessions, settings and bands live in a validated IndexedDB snapshot. Legacy data is migrated; the unused sync queue was removed. Consequence: schema changes need migrations and validated import recovery. Original decision date/rationale beyond the documented consistency/recovery design are unknown.

## ET-002: Generate offline caches from the build

Status: observed implementation.
Evidence: scripts/prepare-pages-build.mjs, scripts/verify-pwa.mjs, docs/offline-support.md; commit 8277ffe.
Precache emitted assets and name caches from content. Keep unrelated origin caches during activation. Consequence: verification must exercise the production artifact and a reload with the HTTP cache disabled. No new design decision is being made by this reconstruction.

## ET-003: Cloud sync remains deferred

Status: documented deferred direction; no implementation approval inferred.
Evidence: docs/sync-strategy.md, README.md; documentation history includes b1ff153 (2026-04-29) and 8277ffe.
Current recovery uses JSON export/import. The retained future direction is authenticated snapshot backup with explicit replacement and last-saved-snapshot behavior; Supabase is discussed as a later backend. No account UI/cloud writes are present. Revisit only for an authorized sync task; record-level/real-time sync is not the documented default.

## ET-004: Rest and band settings replace older UI assumptions

Status: observed implementation.
Evidence: commit c58a8ab (2026-09-02), src/App.tsx, src/domain/bands.ts and IndexedDB migration version 5.
Current settings expose hiding rest times and band ordering/removal; the migration retires the old light/dark preference. Consequence: older README/plan theme descriptions need reconciliation before reuse. The original rationale for this UI change is not established here.

## Recording future work

Add a dated entry for a material new decision, include rationale actually discussed and evidence, and explicitly label proposed, deferred, rejected or superseded ideas. Retain experiment locations only when they exist.
