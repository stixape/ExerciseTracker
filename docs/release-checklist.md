# Final Release Checklist

Use this checklist before treating a GitHub Pages deployment as final.

## Automated Gate

Run locally:

```bash
npm ci
npx playwright install chromium
npm run verify
```

Use Node.js 24.19.x and npm 11.17.x. Do not create or commit another lockfile.

Confirm the pull-request verification job passes before merging. On `main`, the workflow must build the Pages artifact once, run the production-preview and offline suites against that exact `dist`, upload that same directory, and deploy it from the separate privileged job.

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

- Do not edit a cache version manually. `scripts/prepare-pages-build.mjs` derives it from the worker template and all precached file contents.
- Confirm `dist/404.html` is identical to `dist/index.html` and therefore references the same hashed assets.
- Confirm `dist/service-worker.js` has no `__EXERCISE_TRACKER_` placeholders and includes every emitted Vite asset.
- Run `npm run test:pwa`. It must pass with the browser HTTP cache disabled, retain its unrelated-cache sentinel, remove its stale ExerciseTracker-cache sentinel, and reload the app while offline.
- After deployment, verify the live `service-worker.js` contains a generated `exercise-tracker-<hash>` cache name.
- If an installed copy does not update, reopen it online once so the browser can fetch and activate the new worker. Existing app data should not be cleared as part of an update.

See `offline-support.md` for the cache lifecycle and first-visit boundary.

## Security And Supply Chain

- Confirm `npm audit --omit=dev --audit-level=high` passes in CI.
- Confirm workflow actions remain pinned to full commit hashes and review those hashes when upgrading action versions.
- Confirm the pull-request job has only `contents: read`; only the dependent deployment job may request `pages: write` and `id-token: write`.
- Check the production console for content-security-policy or service-worker registration errors.
- Remember that GitHub Pages projects under the same account share one origin. Use a dedicated origin before storing data that requires stronger application isolation.

## Release Boundaries

- No accounts, backend sync, Supabase client, server-side migrations, or cloud data writes are expected in this release.
- Browser storage is the only persistent data store unless the user exports JSON.
- Clearing browser data or uninstalling the PWA can delete local records unless a JSON backup exists.
- The meta content security policy is a GitHub Pages-compatible fallback. A host that can send HTTP security headers is required for policies such as `frame-ancestors` and HSTS.
