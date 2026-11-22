# ExerciseTracker project status

Updated 2026-11-22 on `codex/workout-plan-ranges`, based on `3155a3b`. This branch began with partial range edits from the earlier interrupted turn. Publishing requires the approval recorded in AGENTS.md.

## Implemented

- Workout opens directly to Today's plan. The landing panel scrolls its exercise list when needed and keeps the start or resume button in view. Completed session and set totals appear in Progress.
- Today's summary puts load first and groups consecutive identical sets, for example `45 KG - 3x5`. Plan accepts ranges for reps and seconds. The active workout shows the range and prefills the numeric performed field with the lower bound.
- Routine save and backup banners are removed. Actionable alerts remain visible and Settings shows the latest verified backup.
- Plan includes custom rest minutes, multiline notes and numeric or text Other modifiers. Active-workout notes save to the matching plan immediately. Other targets staged during a workout apply on completion, and history retains the recorded labels and values.
- Canonical IndexedDB schema v7 preserves the revision checks and checkpoints and adds a transactional completed-workout file queue.
- Ready/empty/recovery startup states; defaults require explicit creation. Original legacy strings, retired table rows and pre-normalisation/pre-replacement records are preserved. Interrupted upgrades roll back atomically and can retry. Canonical saves do not depend on access to obsolete localStorage.
- Exclusive, previewed/confirmed import/reset/restore. Unfinished fields stay outside committed state. Failed saves retain pending valid changes for rescue export and explicit retry; workout-save navigation waits for commitment.
- Portable JSON v6 with snapshot identity, source revision/time and SHA-256 checks. Imports cover v1–v6, including v5 checksum verification. The optional remote schema accepts v5 and v6.
- A saved workout produces a verified JSON file when a supported device folder is connected. The folder keeps the newest two verified automatic workout files. Manual and protected copies use their existing recovery paths. If access is unavailable, Settings offers manual downloads and folder reconnection.
- Optional Supabase authentication and immutable owner/device-stream backup integration, disabled until a dedicated origin is configured and a user opts in and approves uploads. Reset/import/restore pauses uploads and rotates the next stream. Client retries/read-back checks and server migration/policy tests are included; remote versions never automatically replace local data.
- Historical band values are preserved through archive/restore; recorded session details remain readable after plan changes. Starter datasets no longer share a mutable palette. Compatible dependency security updates and patched Vitest 4.1.12 are locked.

See [architecture](ARCHITECTURE.md), [decisions](DECISIONS.md), [recovery instructions](docs/recovery.md), [audit and evidence limits](docs/reliability-audit.md), and [optional remote setup](docs/sync-strategy.md).

## Pages deployment on 2026-11-22

- The user approved a one-time, non-force push of `5e46927` to `refs/heads/main` at `https://github.com/stixape/ExerciseTracker.git` for https://stixape.github.io/ExerciseTracker/. GitHub confirmed that update. This consumed the approval for that commit.
- [Pages run 45019588720](https://github.com/stixape/ExerciseTracker/actions/runs/45019588720) stopped at Chromium installation because Playwright 1.59.1 does not support the Ubuntu 26.04 `ubuntu-latest` runner. The deploy job was skipped.
- The user separately approved a one-time, non-force push of `5dc03ab` to the same repository and branch. GitHub confirmed that update. Chromium installed successfully on `ubuntu-24.04`, then [Pages run 45019934463](https://github.com/stixape/ExerciseTracker/actions/runs/45019934463) and its rerun stopped at the flaky-test gate. GitHub skipped deployment on both attempts.
- The browser test follow-up makes the band test wait for the active set before checking order and verifies keyboard focus and scrolling separately in the long-plan test. Sixteen repeated checks passed locally, followed by the full browser suite. The standalone offline check passed after the first local preview timed out.
- The user approved a one-time, non-force push of `a663851` to `refs/heads/main` at `https://github.com/stixape/ExerciseTracker.git`. GitHub confirmed the updated ref. [Pages run 45020887506](https://github.com/stixape/ExerciseTracker/actions/runs/45020887506) passed verification and deployed the update.
- The [live app](https://stixape.github.io/ExerciseTracker/) served `index-DoFXkkFK.js` and a service worker with cache `exercise-tracker-1c34599430592365`. A fresh Chromium context verified the Workout landing, the Plan rest and Other controls, and starting a workout offline after reloading.

## Workout range verification on 2026-11-22

- `npm run verify` passed on the pinned Node and npm toolchain, including lint, unit tests, the Pages build, desktop and mobile Chromium, and offline verification.
- Coverage includes compact summaries, ordered groups of different sets, invalid range drafts, numeric workout records, Next time replacement, and JSON backup restore.
- A disposable Chromium folder retained access across a page reload. Four saves verified two-file rotation, a visible warning on simulated permission loss, and backlog recovery after reconnecting. This check used the browser's origin-private filesystem to simulate the selected folder. Physical Android folder permissions remain unverified.

### Pages release

- The requested non-force push of `0ad0a3b` to `refs/heads/main` at `https://github.com/stixape/ExerciseTracker.git` reached GitHub. [Run 45043946535](https://github.com/stixape/ExerciseTracker/actions/runs/45043946535) skipped deployment because a browser test reloaded the review screen before the final set had finished saving.
- The test now waits for **Save workout** to become enabled before reloading. Eight repeated desktop and mobile checks passed locally.

## Workout redesign verification on 2026-11-22

- npm run verify passed with Node 24.19.0 and npm 11.17.0. It covered lint, 126 unit tests, the Pages build, 41 Chromium browser tests and offline verification. The desktop run skipped one mobile-only viewport case.
- Browser coverage includes long plans with large text, resume across days, rest overrides, note editing, Other target changes, three-workout rotation with a synthetic Chromium folder handle, and independent JSON restore after clearing a disposable origin.
- Unit coverage includes permission loss, write and deletion failure, duplicate and concurrent retries, exact-revision recovery, failed-save rollback, and v5/v6 backup and CSV compatibility.
- Three interleaved synthetic benchmark runs compared this branch with dcd30b5 using fake IndexedDB. At 500 sessions, the median checkpointed save was 518 → 609 ms and the JSON export was 203 → 221 ms. At 1,500 sessions, those medians were 2,064 → 1,840 ms and 674 → 635 ms. Individual runs varied widely. These figures measure local CPU and process-local storage, and ordinary app edits now avoid folder-file work.
- The physical Android folder check and live Supabase SQL tests are pending. The browser folder tests used Chromium's origin-private filesystem as a synthetic stand-in for the device folder.

## Previous verification on 2026-10-26

- npm run verify passed with Node 24.19.0/npm 11.17.0 in CI mode: lint, 119 unit tests in 16 files, TypeScript/Pages build, 33 desktop/mobile Chromium browser tests, and one intentional desktop skip for a mobile-only viewport check. CI rejects flaky test results.
- The complete-loss drill cleared IndexedDB, localStorage, caches and service workers in disposable browser profiles. It reacquired the shell online, restored an independently downloaded file offline, reopened offline and compared plans, history, bands, settings and the active workout.
- Actual previous-service-worker/schema-v5 upgrades preserved records. The offline regression retained unrelated caches and the saved snapshot with HTTP caching disabled. The final local artifact precached 12 files (build ab089a2bbfbd0932).
- Additional unit coverage verifies invalid legacy/canonical records, rollback after quota failure, interrupted historical upgrade/retry, cross-connection conflicts, replacement races, blocked legacy storage, corrupt/altered files, revoked permissions, failed writes, duplicate remote retries and expired authentication.
- npm audit reported zero vulnerabilities across production and development dependencies after the lockfile updates.
- Synthetic large-history benchmarks and mobile visual inspection were performed. No horizontal overflow was observed at a 393px mobile viewport. Full-snapshot validation/hash/clone cost remains a measured scaling limit; the diagnostic figures and their fake-IndexedDB scope are in the audit document.
- Documentation references and Git whitespace/scope checks were performed. Ignored toolchain/browser caches, screenshots and test reports are not source artifacts or workout backups.

## Remaining release boundaries

- Physical Android Edge/Chrome installation, alarms, folder permission lifecycle, device pressure and hosted/offline behaviour still require the manual release checklist. Mobile emulation is not physical-device verification.
- No Supabase project/credentials or dedicated origin was configured. The 14 checked-in pgTAP policy assertions were prepared but not executed: local Docker/Supabase/Postgres tooling was unavailable. Mocked client tests do not establish live RLS, authentication/email delivery or provider backup operations. Run those checks before enabling the integration.
- The historical data-loss cause is still unproven; no failed-device database or exact installed release was available. No existing user dataset was opened or altered during development. All destructive drills used synthetic, isolated storage.
- Independent files protect against browser clearing, not necessarily device loss. Backup runs while the app is open and recovery reaches only the last independently verified copy. Provider-visible optional backup is not end-to-end encrypted.
- No push destination/ref scope is approved. Follow AGENTS.md before any publishing, origin migration or external provisioning.

## Next useful actions

Use a disposable Android browser profile and synthetic records to complete docs/release-checklist.md. Preserve and verify real JSON backups before any user migration; never clear an existing workout profile for testing. For optional remote release, choose and approve the concrete dedicated origin/project, run the SQL/auth/recovery checks, transfer by verified file and approve publishing separately.

## Historical onboarding

On 2026-10-25, c0b0125 added the project instructions and persistent documents from inspected c58a8ab source on codex/project-documentation-20261025. That documentation-only onboarding did not run application tests or perform publishing. Current verification above supersedes that historical test scope.
