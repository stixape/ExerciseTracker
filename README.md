# ExerciseTracker

ExerciseTracker is a mobile-first local-first PWA for planning workouts, logging sets, using guided rest timers, and reviewing per-exercise progress.

Live app: `https://stixape.github.io/ExerciseTracker/`

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

ExerciseTracker is local-first. Workout plans, active workouts, completed sessions, settings, and band colours stay in this browser's local storage and IndexedDB unless you export them.

The current release does not include accounts, backend sync, cloud backup, or account recovery. Clearing browser data, uninstalling the PWA, or using a different device can remove local records unless you have exported a JSON backup first.

## Development

```bash
npm install
npx playwright install chromium
npm run dev
```

## Verification

```bash
npm run lint
npm test
npm run build:pages
npm run test:e2e
```

The GitHub Pages workflow runs install, lint, Vitest, production-preview Playwright smoke tests, Pages build, and deploy.

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

See `docs/release-checklist.md` for the final release checklist and `docs/sync-strategy.md` for the deferred sync direction.
