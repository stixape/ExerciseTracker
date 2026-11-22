# Backup and recovery

ExerciseTracker works offline. Browser storage is disposable: installation and an eviction-protection grant do not make a backup. Recovery reaches only the last independently verified copy.

## Protect records

1. Open Settings → Backup and recovery. Download a JSON backup and keep it outside browser storage, for example in Documents. CSV is not a full backup.
2. Select that saved file with **Verify saved backup**. Download initiation alone is not proof of a saved file. The verified revision and time appear separately from the current local revision.
3. Where available, choose a backup folder. After **Save workout** succeeds, the app writes that revision as JSON, reads it back and verifies the checksum. The app shows workout backup status separately from the local save. Keep the app open while the file is written.
4. Keep another copy off the device if device loss matters. Optional remote backup is described in [sync-strategy.md](sync-strategy.md).

Folder support is feature-detected. If access is lost, reopen the app or reconnect the folder in Settings to retry. During an outage the app keeps the two most recent pending workout revisions. Use the manual JSON download and verification controls on browsers without folder access. The actual Android browser still needs the device checks in the release checklist.

Automatic workout retention keeps the two newest verified workout files and deletes the oldest only after verifying a replacement. Folder sequence numbers handle clock changes. On-demand folder files use the previous 20 recent plus 30 daily policy, with protected pre-replacement copies kept until deliberate manual cleanup. Rotation preserves unknown, interrupted and corrupt files. Backup files contain readable workout records, so choose their location accordingly.

## Restore after loss

1. Preserve any surviving files and browser records. Do not clear storage or create a starter plan as a troubleshooting step.
2. If both application caches and records were lost, first reconnect long enough to reacquire the application shell. An uncached application cannot launch offline.
3. On **Restore or start ExerciseTracker**, select a JSON backup, review its plan/session counts and confirm **Restore this backup**. File restoration works offline once the shell is cached.
4. Reopen offline and check the plan, history and active workout. Reconnect the backup folder and verify the new local revision.

Version 6 includes per-exercise rest, notes and Other modifiers. Versions 1–5 remain importable, with checksum verification for v5 and v6. Restore creates a new local revision. Browser memory and schema collection limits still apply. A file that cannot be read or validated leaves the existing data intact.

## When saving fails

**Saving** and **Saved on this device** describe local commit state, not backup durability. If a write fails, keep the page open. Export unsaved changes as a rescue JSON file, then retry. A stale window cannot overwrite another window's newer revision; export any pending changes before explicitly reloading saved data. Do not import a backup over an unresolved failed edit: rescue/reload first.

Incomplete editor fields stay in their fields and are marked invalid; they do not poison the persisted plan or its JSON backup. Finish those fields before completing a set.

Device checkpoints can undo mistakes, imports and resets, but share the browser's failure boundary. Restore a checkpoint only after reviewing its date, revision and session count. Checkpoints are checked before restore/export. Import/reset also preserves the previous raw record; reset never clears checkpoint history or independent files.

An unreadable canonical/legacy record opens a recovery screen, never an automatically saved starter plan. **Export original recovery sources** produces a private raw recovery bundle for diagnosis. It is not a normal importable backup. Original legacy strings, old workout/queue rows and pre-normalisation snapshots are retained, including when a migration cannot interpret them. Structural migration can complete with an invalid head retained so an explicitly confirmed valid backup can restore service without clearing the database.

## Verification boundary

`npm run verify` includes desktop/mobile Chromium tests that clear the entire disposable origin: IndexedDB, localStorage, Cache Storage and service workers. They reacquire the shell, disconnect, restore an independently downloaded file, reload offline and compare all records. Never run destructive drills in a real workout browser profile.

Physical Android Edge/Chrome folder permissions, installation, device pressure and real hosted deployment still need the [release checklist](release-checklist.md). Automated mobile emulation does not establish those behaviours.
