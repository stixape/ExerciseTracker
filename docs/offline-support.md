# Offline Support

ExerciseTracker uses a generated service worker so the files tested at release time are the files available offline.

## Build And Cache Model

`npm run build:pages` performs three release steps:

1. Vite emits the production application under the `/ExerciseTracker/` base path.
2. `dist/index.html` is copied byte-for-byte to `dist/404.html`, so GitHub Pages direct-route recovery references the same hashed JavaScript and CSS.
3. `scripts/prepare-pages-build.mjs` inventories every other emitted file, sorts the paths, hashes their names and contents, and injects the resulting cache name and complete precache list into `dist/service-worker.js`.

The source `public/service-worker.js` is a template. Its placeholders are expected in source control and are rejected if they remain in the release output. Neither `404.html` nor the worker itself is duplicated in the precache.

## Runtime Behavior

- Installation precaches the complete build before the worker becomes active.
- Activation immediately claims open pages and deletes only stale caches whose names begin with `exercise-tracker-`.
- Navigations try the network first and fall back to the precached `index.html`.
- Other same-origin requests inside the app scope use cache-first delivery. Range requests are left to the browser/network.
- Registration bypasses the HTTP cache for worker update checks and reports failures in the browser console.

Offline availability begins after one successful online load has finished and the service worker has activated. A device that has never loaded the release cannot install it offline, and closing the browser before initial precaching finishes can interrupt installation.

Application records remain in the browser's IndexedDB as one validated snapshot. A one-time migration reads records created by the earlier local-storage/IndexedDB design and removes the old stores only after the snapshot is safely written. The service-worker cache contains application files, not workout records. Updating or replacing an app cache must not clear user data.

## Automated Regression

Run a Pages build before the regression:

```bash
npm run build:pages
npm run test:pwa
```

The regression serves the existing `dist` directory, creates both an unrelated origin cache and a stale ExerciseTracker cache, completes a first online visit, and verifies the generated precache contains every expected release file. It then disables the browser's ordinary HTTP cache, takes the browser offline, reloads, and waits for the application heading. It fails if the app relies on the HTTP cache, misses a release file, removes another app's cache, or retains its own stale cache.

Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Microsoft Edge instead of the Playwright-managed Chromium build.

## Troubleshooting

- Build placeholders in `dist/service-worker.js`: rerun `npm run build:pages`, not `npm run build`.
- A direct route returns the Pages 404 screen: confirm the deployed artifact includes the generated `404.html`.
- A first offline reload fails: reopen the app online, wait for the page to finish loading, and inspect the service-worker registration/install error in developer tools.
- An old installed release remains visible: open it online once or close and reopen it so the browser performs the worker update check.
