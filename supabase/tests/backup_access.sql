-- Run with supabase test db against a disposable local instance after migrations.
begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
insert into auth.users(id, email) values
  ('10000000-0000-0000-0000-000000000001', 'backup-one@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'backup-two@example.invalid');
set local role authenticated;
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select lives_ok($$insert into public.backup_snapshots(user_id,device_id,id,revision,saved_at,payload)
  values(auth.uid(),'device-one','one',100,now(),'{"version":5,"checksum":"synthetic","backup":{},"data":{}}')$$, 'owner inserts');
select is((select count(*) from public.backup_snapshots), 1::bigint, 'owner reads own backup');
select throws_ok($$insert into public.backup_snapshots(user_id,device_id,id,revision,saved_at,payload)
  values('10000000-0000-0000-0000-000000000002','device-two','foreign',1,now(),'{"version":5,"checksum":"synthetic","backup":{},"data":{}}')$$,
  '42501', null, 'cannot insert into another account');
select throws_ok($$update public.backup_snapshots set revision=2$$, '42501', null, 'existing versions cannot be overwritten');
select throws_ok($$delete from public.backup_snapshots$$, '42501', null, 'client cannot delete snapshots');
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}';
select is((select count(*) from public.backup_snapshots), 0::bigint, 'second account sees no first-account records');
select lives_ok($$select public.prune_my_backup_snapshots('device-one')$$, 'pruning is scoped to the signed-in account');
set local request.jwt.claims = '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}';
select is((select count(*) from public.backup_snapshots), 1::bigint, 'foreign pruning leaves owner backup intact');
select lives_ok($$insert into public.backup_snapshots(user_id,device_id,id,revision,saved_at,pinned,payload)
  select auth.uid(),'device-one','retained-' || g,100-g,now() - g * interval '1 day',g=80,
    '{"version":5,"checksum":"synthetic","backup":{},"data":{}}'::jsonb
  from generate_series(1,80) g$$, 'owner creates version history');
select lives_ok($$select public.prune_my_backup_snapshots('device-one')$$, 'owner retention runs');
select is((select count(*) from public.backup_snapshots), 31::bigint, 'retention keeps recent daily and protected versions');
select is((select count(*) from public.backup_snapshots where id='retained-80'), 1::bigint, 'old protected copy survives');
select lives_ok($$insert into public.backup_snapshots(user_id,device_id,id,revision,saved_at,payload)
  values(auth.uid(),'device-v6','v6',1,now(),'{"version":6,"checksum":"synthetic","backup":{},"data":{}}')$$, 'owner inserts v6');
select throws_ok($$insert into public.backup_snapshots(user_id,device_id,id,revision,saved_at,payload)
  values(auth.uid(),'device-v6','unknown',2,now(),'{"version":7,"checksum":"synthetic","backup":{},"data":{}}')$$,
  '23514', null, 'unknown versions are rejected');
set local role anon;
set local request.jwt.claims = '{}';
select throws_ok($$select * from public.backup_snapshots$$, '42501', null, 'anonymous read is denied');
select throws_ok($$select public.prune_my_backup_snapshots('device-one')$$, '42501', null, 'anonymous pruning is denied');
reset role;
select * from finish();
rollback;
