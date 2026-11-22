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

Status: historical deferred direction, superseded by ET-007 on 2026-10-26 for the optional integration. Hosted enablement remains unapproved/unconfigured.
Evidence: docs/sync-strategy.md, README.md; documentation history includes b1ff153 (2026-04-29) and 8277ffe.
At onboarding, recovery used JSON export/import. The retained future direction was authenticated snapshot backup with explicit replacement and last-saved-snapshot behavior; Supabase was discussed as a later backend. ET-007 replaces single-copy overwrite semantics with retained immutable versions. Record-level/real-time sync remains deferred.

## ET-004: Rest and band settings replace older UI assumptions

Status: observed implementation.
Evidence: commit c58a8ab (2026-09-02), src/App.tsx, src/domain/bands.ts and IndexedDB migration version 5.
At the original observation, settings exposed hiding rest times and band ordering/removal; the migration retired the old light/dark preference. README/plan descriptions were reconciled during the 2026-10-26 reliability work, and ET-008 changes removal to history-preserving archive. The original rationale for the earlier UI change is not established here.

## ET-005: Revision-checked local commits and preserved sources

Status: accepted and implemented, 2026-10-26, following the user's reliability implementation request.
Evidence: src/lib/offlineDb.ts, src/app/TrackerContext.tsx and their regression tests.
Extend ET-001 with schema v6 revisions, transaction-scoped compare-and-replace, strict durability, source archives and rollback checkpoints. Empty and unreadable stores are distinct; neither silently saves a starter plan. Invalid historical business data can remain intact during a structural upgrade so a confirmed valid restore is possible. Pre-normalisation originals remain in recoverySources. Every restored snapshot receives a new local revision. Preserve pending valid edits on write failure and exclude unfinished editor drafts. Consequence: older writers cannot open the newer database schema; stale clients must rescue/reload rather than overwrite.

## ET-006: Independent verified files and explicit restore

Status: accepted and implemented, 2026-10-26.
Evidence: src/lib/fileBackups.ts, src/lib/backupFormat.ts, src/components/BackupPanel.tsx and e2e/reliability.spec.ts.
Use version-5 checksummed JSON with v1–v4 import compatibility. Retain 20 recent plus 30 daily checkpoints/files; pre-destructive copies are protected until explicit cleanup. Device checkpoints share the browser failure boundary. Real selected files are independent of browser storage; ordinary download initiation is not verification. Folder access is feature-detected and may require reconnection. Consequence: recovery reaches only the last verified independent copy; closed-app execution and platform persistence cannot be guaranteed.

## ET-007: Optional immutable remote snapshot backup

Status: accepted and implemented as a disabled-by-default integration, 2026-10-26. Production provisioning, origin selection/deployment, authentication delivery and live policy verification remain external release work.
Evidence: src/lib/remoteBackups.ts, supabase/migrations/, supabase/tests/ and docs/sync-strategy.md.
Supersede ET-003's last-saved-copy policy. Use Supabase authentication and owner-only immutable rows, idempotent inserts/read-back verification, explicit restore, and separate device/restore streams. Reset/import/restore pauses publishing and rotates the next stream so a newer empty dataset cannot prune older remote history. No automatic merge or remote-to-local replacement. Require a dedicated configured origin before authentication and keep secrets out of the frontend. Provider-visible storage is an explicit opt-in; end-to-end encryption/key recovery, native wrappers and real-time/record-level sync remain deferred. Independent files remain useful even when remote backup is enabled.

## ET-008: Preserve historical bands

Status: accepted and implemented, 2026-10-26.
Evidence: src/domain/bands.ts, src/domain/types.ts and band/history regression tests.
Archive bands instead of removing their references from completed snapshots. Existing selections remain readable; new choices omit archived bands. Session details use the recorded snapshot, independently of the current plan. Previously erased values cannot be reconstructed without an older backup; this change does not fabricate them.

## ET-009 · Verify and rotate completed-workout backups

**Accepted, 2026-11-22.** The requested Workout landing starts today's scheduled workout. Successful workout saves queue the exact completed revision and write to the device folder when permission is available. Two verified automatic files cover the latest workout saves. Folder-file rotation starts with the new workout files. Existing downloads, protected files and earlier folder backups keep their original recovery path. JSON v6 supports the new exercise data and supersedes ET-006's portable export version. IndexedDB v7 adds the workout backup queue while preserving existing records.

Evidence lives in [workout backup code](src/lib/workoutBackups.ts), [schema validation](src/lib/appDataSchema.ts) and the [recovery guide](docs/recovery.md).

## Recording future work

Add a dated entry for a material new decision, include rationale actually discussed and evidence, and explicitly label proposed, deferred, rejected or superseded ideas. Retain experiment locations only when they exist.
