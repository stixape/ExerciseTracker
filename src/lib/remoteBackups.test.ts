import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppData } from '../domain/sampleData';
import { commitAppData, offlineDb } from './offlineDb';
import { backupToRemote, pauseRemoteBackup, remoteConfiguration } from './remoteBackups';

beforeEach(async () => { await offlineDb.delete(); await offlineDb.open(); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); offlineDb.close(); });
const config = { VITE_BACKUP_APP_ORIGIN: 'https://tracker.example', VITE_BACKUP_SUPABASE_URL: 'https://example.supabase.co', VITE_BACKUP_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_example' };
describe('optional remote boundary', () => {
  it('requires an exact configured dedicated origin', () => {
    expect(remoteConfiguration(config, 'https://tracker.example')).toEqual({ url: 'https://example.supabase.co', key: 'sb_publishable_example' });
    expect(remoteConfiguration(config, 'https://other.example')).toBeNull();
    expect(remoteConfiguration({ ...config, VITE_BACKUP_APP_ORIGIN: 'https://stixape.github.io' }, 'https://stixape.github.io')).toBeNull();
    expect(remoteConfiguration({ ...config, VITE_BACKUP_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_forbidden' }, 'https://tracker.example')).toBeNull();
    expect(remoteConfiguration({}, 'https://tracker.example')).toBeNull();
  });
  it('never makes network requests or uploads fresh starter data without configuration and approval', async () => {
    const fetch = vi.spyOn(globalThis, 'fetch');
    const saved = await commitAppData(createDefaultAppData('local-user'), null, 'initialise');
    expect(await backupToRemote(saved)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    await offlineDb.preferences.put({ key: 'remote-approved', value: true });
    await pauseRemoteBackup();
    expect(await backupToRemote(saved)).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
});
