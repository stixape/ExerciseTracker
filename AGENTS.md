# ExerciseTracker project instructions

Use PROJECT_STATUS.md for the current handoff, ARCHITECTURE.md for system boundaries and DECISIONS.md for implemented/deferred direction. Update the relevant files when substantial work changes them. Existing README.md, PROJECT_PLAN.md and docs/ remain useful sources; verify them against the current code.

## Project rules

- Preserve the local-first browser model, validated canonical IndexedDB snapshot, migrations and explicit JSON import/reset confirmations. Keep workout records out of source control and routine logs.
- Sync, accounts and cloud backup are deferred; do not activate them based on an old plan or retained idea.
- Use the Node/npm versions in package.json and the existing package-lock.json. Application changes use npm run verify (lint, unit tests, Pages build, browser and offline checks); follow README.md for setup. Documentation-only edits use content/reference and Git diff checks.
- Build-generated service-worker caching must preserve unrelated origin caches and precache the actual built artifact.
- Current code includes a hide-rest setting and editable/reorderable/removable band colours. Verify older descriptions of theme controls and fixed behavior against source before extending them.

## Git and publishing

- Follow the global safe Git workflow: focused local task branches/commits may be created automatically; preserve unrelated edits and require approval for repository creation, merges, history rewriting, force pushes, public exposure and destructive operations.
- Observed remote on 2026-10-25: https://github.com/stixape/ExerciseTracker.git. This is inventory, not push approval.
- Approved push destinations/ref scopes: none recorded. Obtain explicit user approval before the first push under this setup and record its exact scope.
- Pushes to main trigger the Pages workflow; existing public hosting does not authorize a new deployment. Check .github/workflows/deploy.yml and obtain approval for the concrete publishing action.
