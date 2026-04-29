# Sync Strategy

ExerciseTracker remains local-first for the final deployment. No Supabase client, authentication UI, database migrations, server tables, or cloud writes are part of this release.

## Current Release

- The browser is the source of truth.
- JSON export/import/reset is the supported portability and recovery path.
- The local Dexie queue remains an implementation hook for future sync work, but nothing is transmitted.

## Future Default

When sync is approved, use snapshot backup first:

- Payload shape: the existing JSON export envelope, `{ "version": 1, "exportedAt": "...", "data": ... }`.
- Storage model: one private app-data snapshot per authenticated user.
- Restore policy: restoring a server snapshot explicitly replaces local data after user confirmation.
- Conflict policy: last saved snapshot wins; do not merge individual sets, sessions, or template records.

## Recommended Backend Later

- Supabase Auth with email magic-link login.
- One `app_snapshots` table keyed by authenticated user ID.
- Row-level security so users can only read and write their own snapshot.
- Optional Settings status showing last backup and last restore time.

Do not add record-level sync, real-time subscriptions, or multi-writer conflict resolution until there is a concrete need.
