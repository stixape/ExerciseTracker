# Final Release Checklist

Use this checklist before treating a GitHub Pages deployment as final.

## Automated Gate

Run locally:

```bash
npm run lint
npm test
npm run build:pages
npm run test:e2e
```

Confirm the GitHub Pages workflow completes successfully after pushing to `main`. The workflow must install dependencies, install Playwright Chromium, lint, run Vitest, run production-preview Playwright smoke tests, build Pages, upload the artifact, and deploy.

## Hosted Checks

- Fresh desktop browser load at `https://stixape.github.io/ExerciseTracker/`.
- Fresh Android browser load at `https://stixape.github.io/ExerciseTracker/`.
- Android PWA installs from the browser and launches from the home-screen icon.
- Direct route refresh works for:
  - `/ExerciseTracker/plan`
  - `/ExerciseTracker/workout`
  - `/ExerciseTracker/progress`
  - `/ExerciseTracker/settings`
- After one online visit, turning off network still reloads the app shell.
- Starting a workout, completing a set, and waiting/skipping rest keeps the workout usable.
- Rest alarm plays after prior workout interaction.
- JSON export downloads.
- A valid JSON export imports successfully.
- Invalid JSON import shows an error and does not crash.
- Reset clears local plan edits, sessions, active workout state, and custom bands after confirmation.

## Cache And Service Worker

- If app-shell caching changes, bump `CACHE_NAME` in `public/service-worker.js`.
- After deployment, verify the live `service-worker.js` contains the expected cache name.
- If a previously installed browser shows a blank page, refresh once or close and reopen the PWA so the new service worker can activate and clear stale caches.

## Release Boundaries

- No accounts, backend sync, Supabase client, migrations, or cloud data writes are expected in this release.
- Browser storage is the only persistent data store unless the user exports JSON.
- Clearing browser data or uninstalling the PWA can delete local records unless a JSON backup exists.
