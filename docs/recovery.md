# Backup and recovery

ExerciseTracker works offline. Browser storage is disposable: installation and an eviction-protection grant do not make a backup. Recovery reaches only the last independently verified copy.

## Protect records

1. Open Settings → Backup and recovery. Download a JSON backup and keep it outside browser storage, for example in Documents. CSV is not a full backup.
2. Select that saved file with **Verify saved backup**. Download initiation alone is not proof of a saved file. The verified revision and time appear separately from the current local revision.
3. Where available, choose a backup folder. The app writes dated JSON files, closes them, reads them back and verifies their checksum. Automatic backup runs while the app is open, after completed sets/workout saves and settled changes. Permission loss, disk errors and interruptions can prevent it.
4. Keep another copy off the device if device loss matters. Optional remote backup is described in [sync-strategy.md](sync-strategy.md).

Folder support is feature-detected; it must be tested on the actual Android browser. Unsupported browsers retain download/verification controls and a reminder when the current revision lacks an independent copy. A lost directory handle does not delete files: reconnect the folder or select a JSON file again.

Folder retention keeps 20 recent successful versions plus one per day for 30 stored days. Protected pre-replacement copies are retained until deliberate manual cleanup. Only recognised, validated ExerciseTracker files outside that retention set are deleted, after a fresh verified copy exists. The just-verified copy is always retained, including after a clock change. Unknown, interrupted and corrupt files are left alone; retry writes a separate file rather than overwriting a damaged attempt. Backup files contain readable workout records; choose their location accordingly. Checksums detect accidental changes, not malicious forgery or an untrusted backup source.

## Restore after loss

1. Preserve any surviving files and browser records. Do not clear storage or create a starter plan as a troubleshooting step.
2. If both application caches and records were lost, first reconnect long enough to reacquire the application shell. An uncached application cannot launch offline.
3. On **Restore or start ExerciseTracker**, select a JSON backup, review its plan/session counts and confirm **Restore this backup**. File restoration works offline once the shell is cached.
4. Reopen offline and check the plan, history and active workout. Reconnect the backup folder and verify the new local revision.

Versions 1–4 remain importable. Version 5 adds snapshot identity, source revision/time and a checksum. Restore creates a new local revision; it never rolls the local counter backward. File reads have no arbitrary 25 MB limit smaller than a valid export, but browser memory and schema collection limits still apply. A file that cannot be read/validated leaves the existing data untouched.

## When saving fails

**Saving** and **Saved on this device** describe local commit state, not backup durability. If a write fails, keep the page open. Export unsaved changes as a rescue JSON file, then retry. A stale window cannot overwrite another window's newer revision; export any pending changes before explicitly reloading saved data. Do not import a backup over an unresolved failed edit: rescue/reload first.

Incomplete editor fields stay in their fields and are marked invalid; they do not poison the persisted plan or its JSON backup. Finish those fields before completing a set.

Device checkpoints can undo mistakes, imports and resets, but share the browser's failure boundary. Restore a checkpoint only after reviewing its date, revision and session count. Checkpoints are checked before restore/export. Import/reset also preserves the previous raw record; reset never clears checkpoint history or independent files.

An unreadable canonical/legacy record opens a recovery screen, never an automatically saved starter plan. **Export original recovery sources** produces a private raw recovery bundle for diagnosis. It is not a normal importable backup. Original legacy strings, old workout/queue rows and pre-normalisation snapshots are retained, including when a migration cannot interpret them. Structural migration can complete with an invalid head retained so an explicitly confirmed valid backup can restore service without clearing the database.

## Verification boundary

`npm run verify` includes desktop/mobile Chromium tests that clear the entire disposable origin: IndexedDB, localStorage, Cache Storage and service workers. They reacquire the shell, disconnect, restore an independently downloaded file, reload offline and compare all records. Never run destructive drills in a real workout browser profile.

Physical Android Edge/Chrome folder permissions, installation, device pressure and real hosted deployment still need the [release checklist](release-checklist.md). Automated mobile emulation does not establish those behaviours.
