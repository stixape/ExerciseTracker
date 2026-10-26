import type { SupabaseClient } from '@supabase/supabase-js';
import { createId } from '../domain/ids';
import { createJsonExport } from '../domain/export';
import { canonicalJson } from './backupFormat';
import { offlineDb, type AppSnapshot } from './offlineDb';
import { verifyBackupFile } from './fileBackups';

export interface RemoteEnvironment { VITE_BACKUP_APP_ORIGIN?: string; VITE_BACKUP_SUPABASE_URL?: string; VITE_BACKUP_SUPABASE_PUBLISHABLE_KEY?: string }
export function remoteConfiguration(env: RemoteEnvironment = import.meta.env, origin = window.location.origin) {
  try {
    const app = new URL(env.VITE_BACKUP_APP_ORIGIN ?? '');
    const api = new URL(env.VITE_BACKUP_SUPABASE_URL ?? '');
    const key = env.VITE_BACKUP_SUPABASE_PUBLISHABLE_KEY;
    if (!key?.startsWith('sb_publishable_') || app.origin !== origin || app.hostname.endsWith('.github.io') ||
      (api.protocol !== 'https:' && api.hostname !== '127.0.0.1' && api.hostname !== 'localhost')) return null;
    return { url: api.origin, key };
  } catch { return null; }
}
let client: Promise<SupabaseClient> | undefined;
export function remoteClient(): Promise<SupabaseClient> {
  const config = remoteConfiguration();
  if (!config) throw new Error('Remote backup requires a configured dedicated origin.');
  client ??= import('@supabase/supabase-js').then(({ createClient }) => createClient(config.url, config.key, { auth: { flowType: 'pkce', detectSessionInUrl: true },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } }));
  return client;
}
export interface RemoteSnapshot {
  id: string;
  device_id: string;
  revision: number;
  saved_at: string;
  pinned: boolean;
}
export async function listRemoteBackups(offset = 0): Promise<RemoteSnapshot[]> {
  const db = await remoteClient();
  const { data: user, error: authError } = await db.auth.getUser();
  if (authError || !user.user) throw new Error('Sign in again to read remote backups. Offline workouts remain available.');
  const { data, error } = await db.from('backup_snapshots').select('id,device_id,revision,saved_at,pinned')
    .eq('user_id', user.user.id).order('saved_at', { ascending: false }).order('id').range(offset, offset + 99);
  if (error) throw new Error('Remote backups could not be read. Local data was not changed.');
  return data as RemoteSnapshot[];
}
export async function readRemoteBackup(deviceId: string, id: string): Promise<unknown> {
  const db = await remoteClient();
  const { data: user, error: authError } = await db.auth.getUser();
  if (authError || !user.user) throw new Error('Sign in again to restore remote data.');
  const result = await db.from('backup_snapshots').select('payload').eq('user_id', user.user.id).eq('device_id', deviceId).eq('id', id).single();
  if (result.error) throw new Error('Remote backup could not be read. Local data was not changed.');
  return result.data.payload;
}

export async function enableRemoteStream(): Promise<void> {
  // Explicit user action after remote history has been reviewed. A fresh local
  // database or reset never starts publishing starter data by itself.
  await offlineDb.preferences.put({ key: 'remote-approved', value: true });
  window.dispatchEvent(new Event('backup-target-changed'));
}
export async function pauseRemoteBackup(): Promise<void> {
  await offlineDb.preferences.put({ key: 'remote-approved', value: false });
  window.dispatchEvent(new Event('backup-target-changed'));
}

export async function backupToRemote(snapshot: AppSnapshot, pinned = false): Promise<boolean> {
  if (!remoteConfiguration() || !navigator.onLine || (await offlineDb.preferences.get('remote-enabled'))?.value !== true ||
    (await offlineDb.preferences.get('remote-approved'))?.value !== true) return false;
  const db = await remoteClient();
  const { data, error: authError } = await db.auth.getUser();
  if (authError || !data.user) throw new Error('Remote backup needs sign-in. Your workout is saved locally.');
  let deviceId = (await offlineDb.preferences.get('backup-device-id'))?.value as string | undefined;
  if (!deviceId) {
    // A transaction prevents two open windows from creating different streams.
    deviceId = await offlineDb.transaction('rw', offlineDb.preferences, async () => {
      const existing = (await offlineDb.preferences.get('backup-device-id'))?.value as string | undefined;
      if (existing) return existing;
      const id = createId('device');
      await offlineDb.preferences.put({ key: 'backup-device-id', value: id });
      return id;
    });
  }
  const payload = JSON.parse(createJsonExport(snapshot.data, { snapshotId: snapshot.snapshotId, revision: snapshot.revision, savedAt: snapshot.updatedAt })) as unknown;
  const id = (pinned ? 'protected-' : '') + snapshot.snapshotId;
  const row = { user_id: data.user.id, device_id: deviceId, id, revision: snapshot.revision, saved_at: snapshot.updatedAt, pinned, payload };
  const { error } = await db.from('backup_snapshots').insert(row);
  if (error) {
    if (error.code !== '23505') throw new Error('Remote upload failed. It will retry when this app is open.');
    const existing = await db.from('backup_snapshots').select('payload').eq('user_id', data.user.id).eq('device_id', deviceId).eq('id', id).single();
    if (existing.error || canonicalJson(existing.data.payload) !== canonicalJson(payload)) throw new Error('The remote copy did not match. No existing backup was overwritten.');
  }
  const readBack = await db.from('backup_snapshots').select('payload').eq('user_id', data.user.id).eq('device_id', deviceId).eq('id', id).single();
  if (readBack.error) throw new Error('Remote upload could not be verified.');
  await verifyBackupFile(JSON.stringify(readBack.data.payload), snapshot);
  await offlineDb.preferences.put({ key: 'last-remote-backup', value: { snapshotId: snapshot.snapshotId, revision: snapshot.revision, savedAt: snapshot.updatedAt, verifiedAt: new Date().toISOString() } });
  window.dispatchEvent(new Event('file-backup-updated'));
  await db.rpc('prune_my_backup_snapshots', { target_device: deviceId });
  return true;
}
