# ExerciseTracker project status

Updated: 2026-10-26. Implementation branch: codex/reliable-recovery-20261026, based on c0b0125 (application base c58a8ab). The working tree and index were clean when this work started; no unrelated local edits were incorporated. Resulting commit identity is recorded by Git rather than a self-referential hash here. No push, deployment, new origin or hosted backend provisioning was performed.

## Implemented

- Canonical IndexedDB schema v6 with transaction-scoped revision checks, strict durability, rollback checkpoints and a small checkpoint metadata index. Stale open clients cannot overwrite newer records.
- Ready/empty/recovery startup states; defaults require explicit creation. Original legacy strings, retired table rows and pre-normalisation/pre-replacement records are preserved. Interrupted upgrades roll back atomically and can retry. Canonical saves do not depend on access to obsolete localStorage.
- Exclusive, previewed/confirmed import/reset/restore. Unfinished fields stay outside committed state. Failed saves retain pending valid changes for rescue export and explicit retry; workout-save navigation waits for commitment.
- Portable JSON v5 with snapshot identity, source revision/time and SHA-256 integrity checks; v1–v4 imports remain supported. Downloads are not labelled verified until reselected. No arbitrary import byte limit smaller than a valid export.
- Verified, versioned folder backups where browser capabilities and permissions allow. Interrupted/corrupt attempts remain untouched and retry uses a separate file. Retention keeps 20 recent plus 30 daily copies, protected pre-replacement copies and the just-verified file despite clock changes. Browser-local checkpoints are not independent backups.
- Optional Supabase authentication and immutable owner/device-stream backup integration, disabled until a dedicated origin is configured and a user opts in and approves uploads. Reset/import/restore pauses uploads and rotates the next stream. Client retries/read-back checks and server migration/policy tests are included; remote versions never automatically replace local data.
- Historical band values are preserved through archive/restore; recorded session details remain readable after plan changes. Starter datasets no longer share a mutable palette. Compatible dependency security updates and patched Vitest 4.1.12 are locked.

See [architecture](ARCHITECTURE.md), [decisions](DECISIONS.md), [recovery instructions](docs/recovery.md), [audit and evidence limits](docs/reliability-audit.md), and [optional remote setup](docs/sync-strategy.md).

## Verification performed on 2026-10-26

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
