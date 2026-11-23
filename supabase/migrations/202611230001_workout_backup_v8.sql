alter table public.backup_snapshots drop constraint backup_snapshots_payload_check;

alter table public.backup_snapshots add constraint backup_snapshots_payload_check
  check (coalesce(payload->>'version' in ('5', '6', '7', '8'), false) and payload ? 'checksum' and payload ? 'data' and payload ? 'backup');
