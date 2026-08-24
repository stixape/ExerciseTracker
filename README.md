# ExerciseTracker

ExerciseTracker is a mobile-first, local-first PWA for planning workouts, logging sets, using guided rest timers, and reviewing per-exercise progress.

Live app: [stixape.github.io/ExerciseTracker](https://stixape.github.io/ExerciseTracker/)

## Current Features

- Monday-Saturday workout plan.
- Weight, time, and resistance-band exercise modes.
- Editable sets, weights, reps, seconds, and band colours.
- Active workout flow with rest timers and alarm feedback.
- Manual exercise selection during workouts with automatic return to the earliest incomplete exercise.
- Per-day progress views with PBs, plateau status, weight history charts, and session deletion.
- Light and dark display modes.
- JSON and CSV export, JSON import, and local reset.

## Privacy And Data

ExerciseTracker is local-first. Workout plans, active workouts, completed sessions, settings, and band colours are stored together in one IndexedDB snapshot unless you export them. Existing installations are migrated from the earlier local-storage/IndexedDB split on first load.

The current release does not include accounts, backend sync, cloud backup, or account recovery. Clearing browser data, uninstalling the PWA, or using a different device can remove local records unless you have exported a JSON backup first.

Browser storage is isolated by origin, not by URL path. The hosted app shares the `stixape.github.io` origin with any other project served from that account. A dedicated origin is preferable if the app will hold sensitive records. The content security policy limits the app to same-origin resources, but it does not encrypt local data or protect an unlocked browser profile.

## Development

Use Node.js 24.19.x and npm 11.17.x. The exact package-manager release is recorded in `package.json`; `package-lock.json` is the only dependency lockfile.

```bash
npm ci
npx playwright install chromium
npm run dev
```

## Verification

```bash
npm run verify
```

`verify` lints and runs unit tests, creates the Pages artifact once, then runs both browser suites against that exact `dist` directory. The PWA regression disables the browser's HTTP cache and reloads offline after the first online visit. It also confirms that every emitted build file was precached and that service-worker activation leaves unrelated origin caches alone.

## Offline Support

`npm run build:pages` copies the built `index.html` to `404.html` for direct-route recovery and generates a content-versioned service worker. The generated worker precaches every file emitted by Vite, including the hashed JavaScript and CSS referenced by both HTML files.

After the first online page load has completed and the service worker has activated, the built app shell can reload without a connection. New releases use a content-derived cache name; activation removes only older `exercise-tracker-` caches. There is no manual cache version to bump.

See `docs/offline-support.md` for behavior, limitations, and troubleshooting.

## Deployment

Pull requests run the read-only verification job without Pages or identity-token permissions. Pushes to `main` run the same gate, upload the already-tested `dist` artifact, then pass it to a separate least-privilege deployment job. Third-party workflow actions are pinned to reviewed commit hashes.

## Release Notes

- Final deployment target: `https://stixape.github.io/ExerciseTracker/`
- Release model: stable personal-use local-first PWA.
- Known limitations: no cross-device sync, no account recovery, no cloud backup, no reminders, and no automatic progression.
- Future sync direction: snapshot backup using the existing JSON export envelope, not record-level or real-time sync.

## Hosted Testing Checklist

- Open `https://stixape.github.io/ExerciseTracker/` on desktop and Android.
- Install the PWA on Android and confirm it launches from the home-screen icon.
- Start a workout, complete a set, and confirm the rest alarm works after interaction.
- Reload `/ExerciseTracker/plan` and `/ExerciseTracker/settings` directly.
- Export JSON, import that JSON, reject an invalid JSON file, and reset local data.
- Turn off network after first load and confirm the app shell reloads.

See `docs/release-checklist.md` for the final release checklist, `docs/offline-support.md` for the offline design, and `docs/sync-strategy.md` for the deferred sync direction.
