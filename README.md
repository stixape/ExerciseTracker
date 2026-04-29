# ExerciseTracker

ExerciseTracker is a mobile-first local-first PWA for planning workouts, logging sets, using guided rest timers, and reviewing per-exercise progress.

## Current Features

- Monday-Saturday workout plan.
- Weight, time, and resistance-band exercise modes.
- Editable sets, weights, reps, seconds, and band colours.
- Active workout flow with rest timers and alarm feedback.
- Manual exercise selection during workouts with automatic return to the earliest incomplete exercise.
- Per-day progress views with PBs, plateau status, weight history charts, and session deletion.
- Light and dark display modes.
- JSON and CSV export.

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
npm run test:e2e
npm run build
npm run build:pages
```

## Hosted Testing Checklist

- Open `https://stixape.github.io/ExerciseTracker/` on desktop and Android.
- Install the PWA on Android and confirm it launches from the home-screen icon.
- Start a workout, complete a set, and confirm the rest alarm works after interaction.
- Reload `/ExerciseTracker/plan` and `/ExerciseTracker/settings` directly.
- Export JSON, import that JSON, reject an invalid JSON file, and reset local data.
- Turn off network after first load and confirm the app shell reloads.
