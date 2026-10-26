# Optional versioned remote backup

The default application stays local and account-free. The user approved implementing an optional Supabase integration on 2026-10-26; this supersedes the earlier deferred single-copy, last-saved-snapshot direction. No hosted backend or new origin has been provisioned by local implementation.

## Data and trust model

- Supabase Auth uses email sign-in links with PKCE. Account setup happens only after opt-in.
- backup_snapshots stores immutable version-5 JSON envelopes, scoped by authenticated owner and device/restore stream.
- Inserts are idempotent and read back for checksum validation. Existing rows cannot be updated or deleted through ordinary client grants.
- Server retention keeps 20 recent plus 30 daily versions per stream; protected copies remain. Provider infrastructure backup is separate and still needs an off-site operational strategy.
- Restore validates, previews and explicitly replaces local data with a new revision. There is no automatic remote download, record merge or last-writer overwrite.
- New installations do not publish starter data automatically. The user reviews remote versions and starts a device stream explicitly.
- Import/reset/restore pauses uploads and rotates the next stream, so a new dataset cannot prune earlier remote history. Existing remote/file copies are not deleted by local reset.
- Expired sessions and outages affect backup only. Workout saves do not require network. Uploads retry on subsequent open-app saves/reconnection; execution while closed is not guaranteed.
- Transport/provider-at-rest protection is used; the provider can access workout records. End-to-end encryption and separate recovery-key management remain deferred.

## Provisioning and release boundary

Prepare these steps only for an explicitly approved dedicated origin and Supabase project:

1. Apply supabase/migrations/202610260001_versioned_backups.sql to a private project. Never use a public bucket or a browser service-role/secret key.
2. Set Supabase Auth's site URL and allowlisted redirect URL to the dedicated origin's application settings route. Configure and verify email delivery. The app uses BASE_URL, which remains /ExerciseTracker/ unless separately changed.
3. Run the local policy tests below and verify the same grants/policies in the intended project before release.
4. Populate the public build variables in .env.example: exact VITE_BACKUP_APP_ORIGIN, HTTPS VITE_BACKUP_SUPABASE_URL and VITE_BACKUP_SUPABASE_PUBLISHABLE_KEY beginning sb_publishable_. Never commit a populated .env file. Vite variables are public.
5. Build/test the configured artifact. The build rejects secret/legacy keys and shared github.io origin configuration; CSP adds only the explicit HTTPS API origin. Runtime also checks the exact app origin.
6. Transfer existing records with a verified JSON file; origins cannot read each other's IndexedDB. Verify restoration on the new origin before retiring anything on the old origin. Keep both copies during transition.
7. Obtain the required concrete publishing/origin approval before deployment. This implementation does not authorise a new hostname, public exposure or account/database provisioning.

On the configured origin, enable optional remote backup, sign in, review remote versions and choose Start backup from this device. The app reports the last independently verified remote revision. Reset/restoration requires reviewing and approving uploads again. Turning uploads off or signing out preserves local records and existing remote versions.

## SQL verification

With a disposable local Supabase instance and Docker:

```bash
supabase start
supabase db reset
supabase test db
```

The checked-in local config, migration and fourteen pgTAP assertions cover owner access, cross-account/anonymous denial, denied update/delete, account-scoped retention and protected versions. Use only synthetic accounts. Tests roll back their rows. Live SQL/email/auth behaviour must not be claimed verified without actually running against the configured service.

[Supabase RLS documentation](https://supabase.com/docs/guides/database/postgres/row-level-security) explains the owner policy and secret-key boundary. [Provider backup documentation](https://supabase.com/docs/guides/platform/backups) distinguishes infrastructure recovery from the user's retained snapshots.

Record-level sync, CRDTs, subscriptions, automatic merges and native Android packaging remain out of scope.
