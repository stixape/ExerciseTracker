# ExerciseTracker

ExerciseTracker is a mobile-first, offline-first PWA for planning workouts, logging sets, guided rest and progress history.

Existing public deployment: [stixape.github.io/ExerciseTracker](https://stixape.github.io/ExerciseTracker/). Local changes do not establish that this deployment has been updated.

## Features

- Today's workout in one screen. Plan supports weighted, band, timed and custom exercises, with per-exercise rest and notes.
- Editable targets, active workout selection, reviewed next targets and optional rest countdowns.
- Per-exercise progress, personal bests, charts and recorded session details.
- Band reordering and history-preserving archive.
- Revision-checked IndexedDB, preserved migration sources and device recovery checkpoints.
- Confirmed JSON restore/reset, CSV export, verified folder backup where supported and download verification.
- Optional versioned Supabase backup on a configured dedicated origin, disabled by default.

## Privacy and recovery

Browser storage is not permanently durable. Installation and persistent-storage permission do not provide recovery after clearing data or losing a device. Device checkpoints share that failure boundary.

Use Settings → Backup and recovery to connect a supported device folder. Saving a completed workout writes a verified JSON backup and keeps the two newest automatic copies. If folder access is unavailable, download a JSON file and reselect it to verify the copy. CSV is available for session analysis.

An empty/unreadable store opens recovery controls instead of silently writing defaults. Imports preview the plan/session counts and require confirmation. Restore receives a new local revision; reset preserves checkpoints, original sources and independent files.

See [recovery instructions](docs/recovery.md) and the [investigation with evidence limits](docs/reliability-audit.md). No failed-device database was available, so the historical incident's exact cause remains unproven.

The existing hosted app shares the stixape.github.io origin with other projects. URL paths are not a storage-security boundary. Remote authentication is prohibited on that shared origin. Optional backup requires a dedicated origin, a private configured service and explicit opt-in. Files are readable workout records; provider-backed remote storage is not end-to-end encrypted. See [remote setup](docs/sync-strategy.md).

## Development

Use Node.js 24.19.x and npm 11.17.x. package.json records the exact package manager; package-lock.json is the only lockfile.

```bash
npm ci
npx playwright install chromium
npm run dev
```

## Verification

```bash
npm run verify
npm run benchmark:storage
```

The release gate lints, runs unit tests, builds the Pages artifact once, then tests that same dist with desktop/mobile Chromium and the offline regression. Recovery tests clear IndexedDB, localStorage, caches and service workers in disposable profiles, reacquire the shell and restore a downloaded file offline. They also exercise stale clients and a previous service-worker/schema upgrade.

The offline regression disables ordinary HTTP caching, checks all emitted assets were precached, preserves unrelated origin caches and compares saved data after reload. The benchmark uses only synthetic process-local fake IndexedDB; it does not establish Android disk performance. Optional SQL access tests are described in docs/sync-strategy.md.

## Offline delivery and deployment

npm run build:pages generates an exact 404.html fallback and a content-versioned service worker that precaches all emitted assets, including optional code chunks. A successful initial online load and service-worker activation are required before offline use. After complete loss of shell caches and records, reacquire the shell online before restoring offline.

Pull requests verify without publishing permissions. A main push or workflow dispatch can deploy the tested artifact through the Pages workflow. No push, origin change or deployment is authorised merely by a configured remote or this README. Follow AGENTS.md.

See [offline design](docs/offline-support.md) and the [release checklist](docs/release-checklist.md). Physical Android installation, alarms, folder permissions and hosted behaviour still require manual checks. No guaranteed closed-app backup, real-time cross-device merge or native wrapper is implemented.
