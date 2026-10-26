import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppData } from '../domain/sampleData';
import { commitAppData, offlineDb } from './offlineDb';
import { backupToRemote } from './remoteBackups';

const service = vi.hoisted(() => {
  type Row = { user_id: string; device_id: string; id: string; payload: unknown };
  const rows = new Map<string, Row>();
  const getUser = vi.fn(async () => ({ data: { user: { id: 'synthetic-account' } }, error: null as Error | null }));
  const insert = vi.fn(async (row: Row) => {
    const key = row.user_id + '/' + row.device_id + '/' + row.id;
    if (rows.has(key)) return { error: { code: '23505' } };
    rows.set(key, structuredClone(row));
    return { error: null };
  });
  const client = {
    auth: { getUser },
    from: () => {
      const filters: Record<string, string> = {};
      const query = {
        insert,
        select: () => query,
        eq: (key: string, value: string) => { filters[key] = value; return query; },
        single: async () => {
          const row = [...rows.values()].find((item) => Object.entries(filters).every(([key, value]) => item[key as keyof Row] === value));
          return row ? { data: { payload: row.payload }, error: null } : { data: null, error: new Error('Not found') };
        },
      };
      return query;
    },
    rpc: vi.fn(async () => ({ data: null, error: null })),
  };
  return { rows, insert, getUser, client };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => service.client }));

beforeEach(async () => {
  service.rows.clear(); service.insert.mockClear(); service.getUser.mockClear();
  vi.stubEnv('VITE_BACKUP_APP_ORIGIN', window.location.origin);
  vi.stubEnv('VITE_BACKUP_SUPABASE_URL', 'https://synthetic.supabase.co');
  vi.stubEnv('VITE_BACKUP_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic');
  await offlineDb.delete(); await offlineDb.open();
  await offlineDb.preferences.bulkPut([{ key: 'remote-enabled', value: true }, { key: 'remote-approved', value: true }]);
});
afterEach(() => { vi.unstubAllEnvs(); offlineDb.close(); });
describe('versioned remote uploads', () => {
  it('retries idempotently without overwriting an existing remote version', async () => {
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    expect(await backupToRemote(saved)).toBe(true);
    expect(await backupToRemote(saved)).toBe(true);
    expect(service.rows.size).toBe(1);
    expect((await offlineDb.preferences.get('last-remote-backup'))?.value).toMatchObject({ snapshotId: saved.snapshotId });
  });
  it('retains earlier versions and a protected copy before a reset', async () => {
    const first = await commitAppData(createDefaultAppData('local-user'), null);
    await backupToRemote(first);
    await backupToRemote(first, true);
    const second = await commitAppData({ ...first.data, settings: { hideRestTimes: true } }, 1);
    await backupToRemote(second);
    expect(service.rows.size).toBe(3);
    await commitAppData(createDefaultAppData('local-user'), 2, 'reset');
    expect(await backupToRemote(second)).toBe(false);
    expect(service.rows.size).toBe(3);
  });
  it('keeps offline saves available after expired authentication or a failed upload', async () => {
    const first = await commitAppData(createDefaultAppData('local-user'), null);
    service.getUser.mockResolvedValueOnce({ data: { user: null } as never, error: new Error('Expired') });
    await expect(backupToRemote(first)).rejects.toThrow('sign-in');
    service.insert.mockRejectedValueOnce(new Error('Synthetic outage'));
    await expect(backupToRemote(first)).rejects.toThrow();
    const saved = await commitAppData({ ...first.data, settings: { hideRestTimes: true } }, 1);
    expect(saved.revision).toBe(2);
    expect((await offlineDb.preferences.get('last-remote-backup'))).toBeUndefined();
  });
});
