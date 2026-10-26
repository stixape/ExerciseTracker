import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultAppData } from '../domain/sampleData';
import { createJsonExport } from '../domain/export';
import { parseJsonImport } from './localData';
import { commitAppData, offlineDb } from './offlineDb';
import { backupToFolder, folderBackupFilename, verifyBackupFile, type BackupDirectory, type BackupFile } from './fileBackups';

function directoryFixture() {
  const files = new Map<string, string>();
  let allowed = true;
  let failClose = false;
  const directory: BackupDirectory = {
    kind: 'directory',
    queryPermission: async () => allowed ? 'granted' : 'denied',
    async getFileHandle(name, options) {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('Not found', 'NotFoundError');
        files.set(name, '');
      }
      return {
        kind: 'file',
        getFile: async () => ({ text: async () => files.get(name)! } as File),
        createWritable: async () => {
          let pending = '';
          return { write: async (data: string) => { pending = data; }, close: async () => { if (failClose) throw new Error('Synthetic disk failure'); files.set(name, pending); }, abort: async () => undefined };
        },
      };
    },
    async *entries() { for (const name of files.keys()) yield [name, await directory.getFileHandle(name)] as [string, BackupFile]; },
    async removeEntry(name) { files.delete(name); },
  };
  return { files, directory, deny: () => { allowed = false; }, fail: () => { failClose = true; } };
}
beforeEach(async () => { localStorage.clear(); await offlineDb.delete(); await offlineDb.open(); });
afterEach(() => { vi.restoreAllMocks(); offlineDb.close(); });

describe('independent folder files', () => {
  it('reads back, validates and records the exact committed revision', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    const result = await backupToFolder(saved);
    expect(result?.snapshotId).toBe(saved.snapshotId);
    expect(mock.files.size).toBe(1);
    expect((await offlineDb.preferences.toArray()).find((item) => item.key === 'last-file-backup')?.value).toEqual(result);
    await backupToFolder(saved);
    expect(mock.files.size).toBe(1);
  });
  it('does not claim success after disk failure or delete the previous copy', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const first = await commitAppData(createDefaultAppData('local-user'), null);
    await backupToFolder(first);
    const original = [...mock.files.values()][0];
    mock.fail();
    const next = await commitAppData({ ...first.data, settings: { hideRestTimes: true } }, 1);
    await expect(backupToFolder(next)).rejects.toThrow();
    expect([...mock.files.values()]).toContain(original);
    const status = (await offlineDb.preferences.toArray()).find((item) => item.key === 'last-file-backup')?.value;
    expect(status).toMatchObject({ snapshotId: first.snapshotId });
  });
  it('preserves files when folder permission is revoked', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    await backupToFolder(saved);
    mock.deny();
    await expect(backupToFolder(saved)).rejects.toThrow('Reconnect');
    expect(mock.files.size).toBe(1);
  });
  it('never overwrites an invalid existing file or deletes unrelated files', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    const name = folderBackupFilename(saved);
    mock.files.set(name, 'interrupted original');
    mock.files.set('unrelated.json', 'keep');
    expect((await backupToFolder(saved))?.snapshotId).toBe(saved.snapshotId);
    expect(mock.files.get(name)).toBe('interrupted original');
    expect(mock.files.get('unrelated.json')).toBe('keep');
    expect([...mock.files.keys()].some((key) => key.includes('.attempt-'))).toBe(true);
  });
  it('keeps the newly verified file even when older files have future timestamps', async () => {
    const mock = directoryFixture();
    vi.spyOn(offlineDb.preferences, 'get').mockResolvedValue({ key: 'backup-directory', value: mock.directory });
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    for (let index = 0; index < 40; index++) {
      const future = { ...saved, snapshotId: 'snapshot_future_' + index, revision: index + 20, updatedAt: new Date(Date.UTC(2030, 0, index + 1)).toISOString() };
      mock.files.set(folderBackupFilename(future), createJsonExport(future.data, { snapshotId: future.snapshotId, revision: future.revision, savedAt: future.updatedAt }));
    }
    await backupToFolder(saved);
    expect(await verifyBackupFile(mock.files.get(folderBackupFilename(saved))!, saved)).toMatchObject({ snapshotId: saved.snapshotId });
  });
  it('keeps the external file restorable after all synthetic browser data is lost', async () => {
    const saved = await commitAppData(createDefaultAppData('local-user'), null);
    const file = createJsonExport(saved.data, { snapshotId: saved.snapshotId, revision: saved.revision, savedAt: saved.updatedAt });
    await offlineDb.delete(); localStorage.clear(); await offlineDb.open();
    const verified = await verifyBackupFile(file);
    expect(verified.snapshotId).toBe(saved.snapshotId);
    const parsed = parseJsonImport(file, 'local-user');
    if (!parsed.ok) throw new Error(parsed.error);
    const restored = await commitAppData(parsed.data, null, 'restore');
    expect(restored.data).toEqual(saved.data);
  });
});
