-- Apply only to a deliberately provisioned private Supabase project.
create table public.backup_snapshots (
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null check (length(device_id) between 1 and 256),
  id text not null check (length(id) between 1 and 300),
  revision bigint not null check (revision >= 1),
  saved_at timestamptz not null,
  created_at timestamptz not null default now(),
  pinned boolean not null default false,
  payload jsonb not null check (payload->>'version' = '5' and payload ? 'checksum' and payload ? 'data' and payload ? 'backup'),
  primary key (user_id, device_id, id)
);
create index backup_snapshots_owner_saved on public.backup_snapshots (user_id, saved_at desc);
alter table public.backup_snapshots enable row level security;
revoke all on public.backup_snapshots from anon, authenticated;
grant select, insert on public.backup_snapshots to authenticated;
create policy read_own_backups on public.backup_snapshots for select to authenticated using ((select auth.uid()) = user_id);
create policy insert_own_backups on public.backup_snapshots for insert to authenticated with check ((select auth.uid()) = user_id);

-- Retention cannot be used to delete another user's records. Clients cannot
-- update existing rows or delete individual copies through the data API.
create function public.prune_my_backup_snapshots(target_device text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  delete from public.backup_snapshots b
  where b.user_id = auth.uid() and b.device_id = target_device and not b.pinned
    and b.id not in (
      select recent.id from public.backup_snapshots recent
      where recent.user_id = auth.uid() and recent.device_id = target_device
      order by recent.revision desc, recent.saved_at desc limit 20
    )
    and b.id not in (
      select daily.id from (
        select distinct on ((s.saved_at at time zone 'UTC')::date) s.id, s.saved_at
        from public.backup_snapshots s
        where s.user_id = auth.uid() and s.device_id = target_device
        order by (s.saved_at at time zone 'UTC')::date desc, s.saved_at desc, s.revision desc
        limit 30
      ) daily
    );
end;
$$;
revoke all on function public.prune_my_backup_snapshots(text) from public, anon;
grant execute on function public.prune_my_backup_snapshots(text) to authenticated;
